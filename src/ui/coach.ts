/**
 * Just-in-time coach banners (they replace the old three intro cards): one short sentence the moment a
 * feature is revealed (src/ui/progression.ts), in a small non-blocking banner with "Got it". Never a
 * modal. Which ones were read is per-device presentation state in prefs (coachSeen); what is revealed
 * never depends on it. Help lists every message the player has unlocked. Where the banner sits on Battle (and
 * whether it has room for its whole sentence) is the overlay lanes' call (lanes.ts); an info-only line shrinks to one
 * line after COACH_SHRINK_MS on Battle, and only its buttons (and a shrunk line's text) take taps. The queue (oldest unread
 * first, one new line per wave clear, verb lines never retired unseen) is pendingCoach + CoachBanner.update.
 */
import '../styles/coach.css';
import { button, h, show, text } from './dom';
import { icon } from './icons';
import { prefs, setPref } from './prefs';
import { stageOfFeature, type FeatureId, type Features } from './progression';

export type CoachId = 'start' | 'checkpoint' | 'elements' | 'patrol' | 'build' | 'abilities' | 'boons' | 'anomalies' | 'bulk' | 'prestige' | 'cross' | 'inspector'
  | 'cores' | 'frame' | 'exotics' | 'doctrines' | 'machine' | 'salvage' | 'overcharge';

export interface CoachMsg {
  id: CoachId;
  /** Shown once this feature is revealed. */
  feature: FeatureId;
  icon: string;
  text: string;
}

/** In reveal order. Terse, no jargon on first contact. */
export const COACH: readonly CoachMsg[] = [
  { id: 'start', feature: 'tapAssist', icon: 'shield', text: 'Your tower fights on its own. Kills earn Scrap: tap Upgrade to spend it.' },
  { id: 'checkpoint', feature: 'upgradesTab', icon: 'restart', text: 'Boss down: a checkpoint. If the tower falls, it restarts here. More upgrades in the Upgrades tab.' },
  { id: 'elements', feature: 'elements', icon: 'bolt', text: 'Your first real choice: attune an element in Upgrades → Elements.' },
  { id: 'patrol', feature: 'runControls', icon: 'restart', text: 'Push climbs and fights bosses. Patrol loops cleared waves and keeps earning, even while you are away.' },
  { id: 'build', feature: 'buildTab', icon: 'blueprint', text: 'A weapon slot is open: mount a second weapon on the Build tab.' },
  { id: 'doctrines', feature: 'doctrines', icon: 'blueprint', text: 'Doctrine fork: pick one path for this tree. You can change it at a checkpoint.' },
  { id: 'abilities', feature: 'abilities', icon: 'target', text: 'Abilities: tap one to spend Command Energy (CE), then tap the field.' },
  { id: 'boons', feature: 'boons', icon: 'boon', text: 'Boons help until the tower falls. Pick one, or decline.' },
  { id: 'anomalies', feature: 'anomalies', icon: 'info', text: 'Anomaly drafts follow bosses: each card bends the rules until you Prestige.' },
  { id: 'bulk', feature: 'bulk', icon: 'upgrade', text: 'Upgrades now marks ★ Suggested buys, and buys ×10 or Max per tap.' },
  { id: 'prestige', feature: 'prestigeTab', icon: 'prestige', text: 'The Prestige tab is open: its Forecast shows when a fresh start pays off.' },
  { id: 'cross', feature: 'cross', icon: 'bolt', text: 'Your parts can combine now: Upgrades → Cross has your first link.' },
  { id: 'inspector', feature: 'inspector', icon: 'inspector', text: 'Pause opens the Kill-Chain Inspector, which traces why things died. The Codex in More records what you find.' },
  { id: 'cores', feature: 'cores', icon: 'cores', text: 'Cores drop from bosses. Spend them in Upgrades → Cores and on the Build tab.' },
  { id: 'frame', feature: 'frame', icon: 'shield', text: 'Build → Frame shows your machine\'s body. A new Frame is chosen when you Prestige.' },
  { id: 'exotics', feature: 'exotics', icon: 'cores', text: 'Exotics: one Core-priced upgrade per tree, once its Doctrine fork opens (Upgrades → Cores).' },
  { id: 'machine', feature: 'quartermaster', icon: 'more', text: 'A new machine: every tab stays open. Spend your Echoes under Prestige → Echo tiers; Trials and Automation are bought there too, deeper down.' },
  // active edge (docs/ACTIVE.md): shown only while their subject is on screen (LIVE_COACH)
  { id: 'salvage', feature: 'salvage', icon: 'scrap', text: 'Glowing crates: tap them for bonus Scrap. Quick taps chain.' },
  { id: 'overcharge', feature: 'overcharge', icon: 'bolt', text: 'Overcharge is full: hold the glowing button, let go in the bright band.' },
];

/** Explainers tied to an event that can come at any stage (an offer, a draft), not to a stage. */
const EVENT_COACH: ReadonlySet<CoachId> = new Set<CoachId>(['boons', 'anomalies', 'salvage', 'overcharge']);
/**
 * Explainers shown only while their subject is on screen (a salvage crate drifting in, a full Overcharge meter), after
 * any unread stage message. Once shown, the banner keeps one until "Got it" (CoachBanner), so it does not blink with the crates.
 */
const LIVE_COACH: ReadonlySet<CoachId> = new Set<CoachId>(['salvage', 'overcharge']);

/** What makes a message urgent right now (its thing is on screen): it jumps the queue. */
export interface CoachLive {
  boonOffer: boolean; draft: boolean;
  /** A salvage crate is on the field (UiState.active.crates > 0). */
  crate?: boolean;
  /** The Overcharge meter is full and can be charged (UiState.active.overcharge.ready). */
  overchargeReady?: boolean;
}

/** UiState → the live flags of the active-edge explainers. */
export function activeCoachLive(a: { crates: number; overcharge: { ready: boolean } } | undefined): Pick<CoachLive, 'crate' | 'overchargeReady'> {
  return { crate: (a?.crates ?? 0) > 0, overchargeReady: !!a?.overcharge.ready };
}

/**
 * Lines that introduce a verb (a thing the player must do or know to keep going): never retired unseen, i.e. reading a
 * later line never marks them read (staleWith). 'cross' is here because its reveal depends on the build (the first Cross
 * node), so it can arrive after later lines in the table.
 */
export const VERB_COACH: ReadonlySet<CoachId> = new Set<CoachId>(['checkpoint', 'elements', 'patrol', 'build', 'doctrines', 'abilities', 'cross']);

/**
 * The message to show now, or null, among unread messages whose feature is on: an event explainer whose subject is
 * live (a boon offer, an Anomaly draft, a crate, a full Overcharge meter) first; else the OLDEST unread stage message
 * (the coach queue: lines come in the order they were unlocked, at most one new one per wave clear, see CoachBanner);
 * else an event explainer (the active-edge ones only while their subject is live).
 */
export function pendingCoach(f: Features, seen: ReadonlySet<string>, live: CoachLive = { boonOffer: false, draft: false }): CoachMsg | null {
  if (f.unlockAll) return null;
  const liveNow = (m: CoachMsg): boolean => (m.id === 'salvage' && !!live.crate) || (m.id === 'overcharge' && !!live.overchargeReady);
  const open = COACH.filter((m) => f[m.feature] && !seen.has(m.id) && (!LIVE_COACH.has(m.id) || liveNow(m)));
  if (!open.length) return null;
  const urgent = open.find((m) => (m.id === 'boons' && live.boonOffer) || (m.id === 'anomalies' && live.draft));
  const stage = open.filter((m) => !EVENT_COACH.has(m.id));
  return urgent ?? stage[0] ?? open[0];
}

/** Explainers that jump the queue (their subject is on screen): they are not new "stage" lines for the per-wave limit. */
export function isEventCoach(id: string): boolean { return EVENT_COACH.has(id as CoachId); }

/**
 * Reading `id` also retires these: the older stage messages that do not introduce a verb (an event explainer retires
 * only itself; a verb line is never retired by reading another one).
 */
export function staleWith(id: CoachId): CoachId[] {
  if (EVENT_COACH.has(id)) return [id];
  const i = COACH.findIndex((m) => m.id === id);
  return COACH.slice(0, i + 1).filter((m) => !EVENT_COACH.has(m.id) && (m.id === id || !VERB_COACH.has(m.id))).map((m) => m.id);
}

/** Messages the player has unlocked (Help lists them). */
export function unlockedCoach(f: Features): CoachMsg[] {
  return COACH.filter((m) => f[m.feature]);
}

/**
 * First run of the reveal system on this device: whatever is already revealed counts as read (an existing
 * save must not get a stack of banners), except on a brand-new game, where the first message shows.
 */
export function initialSeen(f: Features, stage: number): CoachId[] {
  if (stage === 0 || f.unlockAll) return [];
  return unlockedCoach(f).map((m) => m.id);
}

/**
 * A one-off line from outside the ladder (post-Prestige beats: new content in the pool, the Quartermaster; see
 * ceremony.ts / index.ts). Shown after every unread ladder message, first unread first; read = its id in coachSeen.
 * `action` adds a button (e.g. "Turn on") that runs and then marks the line read.
 */
export interface CoachExtra { id: string; icon: string; text: string; action?: { label: string; run: () => void };
  /** UX Phase 4: the line's entry in the merged post-Prestige card (defaults to `text`), and its button label there. */
  short?: string; digestAction?: string }

/** UX Phase 4 (C-19): the one merged card after a Prestige (its id; reading it reads every line it lists). */
export const DIGEST_ID = 'post-prestige';
export const DIGEST_TITLE = 'A new machine. Open now:';
/** Shorter entries for the ladder lines a Prestige reveals together (the card lists them; Help keeps the full text). */
const DIGEST_SHORT: Partial<Record<CoachId, string>> = {
  machine: 'Echoes: spend them under Prestige → Echo tiers.',
  cores: 'Cores drop from bosses: Upgrades → Cores and Build.',
  frame: 'Build → Frame: your machine\'s body, chosen at Prestige.',
  exotics: 'Exotics: Core-priced upgrades in Upgrades → Cores.',
};

export interface CoachDigest { ids: string[]; items: string[]; action?: CoachExtra['action'] }

/**
 * After a Prestige (prestigeCount ≥ 1), the unread lines a Prestige reveals (stage 7) and the unread post-Prestige extras
 * come as ONE card with a short list instead of a queue of banners (one per wave clear). Null when fewer than two are
 * due. The reveal rules are unchanged: only revealed features' lines (and the extras index.ts offers) are listed. At most
 * one extra's action button (the Quartermaster's "Turn on") rides on the card. Pure (tests).
 */
export function postPrestigeDigest(f: Features, seen: ReadonlySet<string>, extras: readonly CoachExtra[]): CoachDigest | null {
  if (f.unlockAll) return null;
  // only the lines a Prestige reveals (stage 7); earlier unread lines keep the normal queue after the card
  const lines = COACH.filter((m) => f[m.feature] && !seen.has(m.id) && !EVENT_COACH.has(m.id) && stageOfFeature(m.feature) === 7);
  const xs = extras.filter((x) => !seen.has(x.id));
  if (lines.length + xs.length < 2) return null;
  return {
    ids: [...lines.map((m) => m.id), ...xs.map((x) => x.id)],
    items: [...lines.map((m) => DIGEST_SHORT[m.id] ?? m.text), ...xs.map((x) => x.short ?? x.text)],
    action: (() => { const x = xs.find((e) => e.action); return x?.action ? { label: x.digestAction ?? x.action.label, run: x.action.run } : undefined; })(),
  };
}

/**
 * An info-only line (no action button) shrinks to its compact form (up to two lines) once it has been on screen on Battle
 * this long (ms), or as soon as the player acts (taps a control elsewhere) after reading it for COACH_ACT_MS; a tap on it
 * expands it again.
 */
export const COACH_SHRINK_MS = 15000;
/** A tap on another control shrinks the line only after it has been visible this long (ms): a glance, not a mis-tap. */
export const COACH_ACT_MS = 2500;

/**
 * The per-wave limit of the coach queue: may a NEW line be introduced now? `introducedAt` is the wave token at which the
 * last new line came up (null: none yet this session); event explainers (their subject live) are exempt.
 */
export function mayIntroduce(introducedAt: number | null, wave: number, id: string): boolean {
  return isEventCoach(id) || introducedAt === null || introducedAt !== wave;
}

export class CoachBanner {
  readonly el: HTMLElement;
  private readonly ico = h('span', { class: 'coach-ico' });
  private readonly msg = h('span', { class: 'coach-text' });
  private readonly act: HTMLButtonElement;
  private cur: CoachMsg | null = null;
  private extra: CoachExtra | null = null;
  /** The ids the merged post-Prestige card lists (all read on "Got it"), or null. */
  private digestIds: string[] | null = null;
  /** Shrunk (info-only lines): the overlay lanes give it the compact height (lanes.ts). */
  shrunk = false;
  /** Called when the banner changes (a new line, shown / hidden, shrunk / expanded): the overlay lanes re-fit. */
  onChange: (() => void) | null = null;
  /** The banner has a line to show (it may still be held). */
  private want = false;
  /** Held by the attention plan (attention.ts): a celebration, a decision, a boss fight, a fresh death card. */
  private held = false;
  /** The wave token now (Attention.update) and the one at which the last new line came up (the per-wave limit). */
  private wave = 0;
  private introducedAt: number | null = null;
  /** Time on screen on Battle for the current line (ms), and the last sample. */
  private visibleMs = 0;
  private lastSample = 0;
  constructor() {
    const ok = button('Got it', () => this.dismiss(), { class: 'btn small coach-ok' });
    this.act = button('', () => { const x = this.extra; this.dismiss(); x?.action?.run(); }, { class: 'btn small primary coach-act' });
    this.act.hidden = true;
    this.el = h('div', { class: 'coach-banner', attrs: { role: 'status', 'aria-live': 'polite' } }, this.ico, this.msg, this.act, ok);
    this.el.hidden = true;
    // a compact banner opens again on a tap on its text
    this.msg.addEventListener('click', () => { if (this.el.classList.contains('compact')) this.expand(); });
    // the player acting elsewhere (a control, not the arena) after reading the line: it makes room
    if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => {
      const t = e.target as Element | null;
      if (!t || this.el.hidden || this.shrunk || !this.act.hidden || this.el.contains(t)) return;
      if (this.visibleMs >= COACH_ACT_MS && t.closest('button, [role="button"], a')) this.shrink();
    }, { capture: true, passive: true });
  }

  get current(): CoachId | null { return this.cur?.id ?? null; }
  /** The id on the banner (a ladder line or an extra), shown or held. */
  get currentId(): string | null { return this.cur?.id ?? this.extra?.id ?? null; }

  /** The attention plan holds the banner (it keeps its line; it shows again when released). */
  setHeld(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    this.sync();
  }

  /** The wave token (any number that changes when a wave is cleared); the queue introduces at most one line per token. */
  setWave(w: number): void { this.wave = w; }

  /**
   * Time on Battle: `visible` says whether the banner is on screen there now (placed by the lanes, Battle in view). An
   * info-only line shrinks after COACH_SHRINK_MS of it.
   */
  sample(visible: boolean, now = performance.now()): void {
    const dt = this.lastSample ? Math.min(1000, Math.max(0, now - this.lastSample)) : 0;
    this.lastSample = now;
    if (!visible || this.el.hidden) return;
    this.visibleMs += dt;
    if (!this.shrunk && this.act.hidden && this.visibleMs >= COACH_SHRINK_MS) this.shrink();
  }

  private shrink(): void { this.shrunk = true; this.onChange?.(); }

  private sync(): void {
    const on = this.want && !this.held;
    if (on === !this.el.hidden) return;
    show(this.el, on);
    this.onChange?.();
  }

  /** `extras` wait behind the ladder; `hold` ids count as read for now (e.g. 'machine' while the Echo guide runs). */
  update(f: Features, live: CoachLive, extras: readonly CoachExtra[] = [], hold: readonly string[] = [], afterPrestige = false): void {
    const read = new Set(prefs().coachSeen);
    const seen = new Set([...read, ...hold]);
    let next = pendingCoach(f, seen, live);
    // UX Phase 4: after a Prestige, the lines it revealed come as one card (it waits while a hold runs, e.g. the Echo guide)
    const digest = afterPrestige ? postPrestigeDigest(f, read, extras) : null;
    if (digest) {
      const urgent = next && isEventCoach(next.id) ? next : null;
      if (!urgent) {
        if (hold.length) { if (this.cur || this.extra) this.showExtra(null); return; }
        const items = digest.items;
        this.showExtra({ id: DIGEST_ID, icon: 'prestige', text: `${DIGEST_TITLE} ${items.join(' ')}`, action: digest.action }, { ids: digest.ids, items });
        return;
      }
    } else if (this.digestIds) this.showExtra(null);
    // the queue: at most one new line per wave clear (a line already up stays; an urgent explainer may jump in)
    if (next && next.id !== this.cur?.id && !mayIntroduce(this.introducedAt, this.wave, next.id)) {
      if (this.cur && !seen.has(this.cur.id)) next = this.cur;
      else return;   // it waits for the next wave clear (whatever is up stays)
    }
    if (!next && !f.unlockAll && !(this.cur && LIVE_COACH.has(this.cur.id) && !seen.has(this.cur.id))) {
      let x = extras.find((e) => !seen.has(e.id)) ?? null;
      if (x && x.id !== this.extra?.id && !mayIntroduce(this.introducedAt, this.wave, x.id)) x = this.extra && !seen.has(this.extra.id) ? this.extra : null;
      if (x || this.extra) { this.showExtra(x); return; }
    } else if (this.extra) { this.extra = null; this.act.hidden = true; }
    if (next?.id === this.cur?.id) { if (next && !this.want) { this.want = true; this.sync(); this.fresh(); } return; }
    // a live explainer stays up until read, even after its crate is gone (unless something else is due)
    if (!next && this.cur && LIVE_COACH.has(this.cur.id) && !seen.has(this.cur.id) && !f.unlockAll) return;
    this.cur = next;
    this.want = !!next;
    this.sync();
    if (!next) { this.fresh(); return; }
    if (!isEventCoach(next.id)) this.introducedAt = this.wave;
    this.ico.replaceChildren(icon(next.icon, 'ico'));
    text(this.msg, next.text);
    this.el.dataset.coach = next.id;
    // replay the entrance for each new message
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.fresh();
  }

  private showExtra(x: CoachExtra | null, digest: { ids: string[]; items: string[] } | null = null): void {
    this.cur = null;
    if (x?.id === this.extra?.id && x?.text === this.extra?.text) { if (x && !this.want) { this.want = true; this.sync(); } return; }
    this.extra = x;
    this.digestIds = digest ? digest.ids : null;
    this.want = !!x;
    this.sync();
    this.act.hidden = !x?.action;
    if (!x) { this.fresh(); return; }
    this.introducedAt = this.wave;
    text(this.act, x.action?.label ?? '');
    this.ico.replaceChildren(icon(x.icon, 'ico'));
    if (digest) this.msg.replaceChildren(h('span', { class: 'coach-digest-title', text: DIGEST_TITLE }),
      h('ul', { class: 'coach-digest' }, ...digest.items.map((t) => h('li', { text: t }))));
    else text(this.msg, x.text);
    this.el.classList.toggle('digest', !!digest);
    this.el.dataset.coach = x.id;
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.fresh();
  }

  /** A new line (or the banner shown / hidden): full size again, its time on Battle from zero. */
  private fresh(): void {
    this.shrunk = false;
    this.visibleMs = 0;
    this.onChange?.();
  }

  /** Tap on a compact banner: the whole sentence again (it shrinks back after COACH_SHRINK_MS more on Battle). */
  expand(): void { this.fresh(); }

  dismiss(): void {
    if (this.extra) { markCoachSeen(this.digestIds ? [...this.digestIds, this.extra.id] : [this.extra.id]); this.extra = null; this.digestIds = null; this.act.hidden = true; this.want = false; this.sync(); this.fresh(); return; }
    const id = this.cur?.id;
    if (!id) return;
    markCoachSeen(staleWith(id));
    this.cur = null;
    this.want = false;
    this.sync();
    this.fresh();
  }
}

export function markCoachSeen(ids: readonly string[]): void {
  const seen = new Set(prefs().coachSeen);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) setPref('coachSeen', [...seen]);
}

