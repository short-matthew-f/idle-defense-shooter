/**
 * Just-in-time coach banners (they replace the old three intro cards): one short sentence the moment a
 * feature is revealed (src/ui/progression.ts), in a small non-blocking banner with "Got it". Never a
 * modal. Which ones were read is per-device presentation state in prefs (coachSeen); what is revealed
 * never depends on it. Help lists every message the player has unlocked. Where the banner sits on Battle (and
 * whether it has room for its whole sentence) is the overlay lanes' call (lanes.ts); an info-only line shrinks to one
 * line after COACH_SHRINK_MS, and only its buttons (and a shrunk line's text) take taps.
 */
import '../styles/coach.css';
import { button, h, show, text } from './dom';
import { icon } from './icons';
import { prefs, setPref } from './prefs';
import type { FeatureId, Features } from './progression';

export type CoachId = 'start' | 'checkpoint' | 'elements' | 'build' | 'abilities' | 'boons' | 'anomalies' | 'bulk' | 'prestige' | 'machine'
  | 'salvage' | 'overcharge';

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
  { id: 'build', feature: 'buildTab', icon: 'blueprint', text: 'A weapon slot is open: mount a second weapon on the Build tab.' },
  { id: 'abilities', feature: 'abilities', icon: 'target', text: 'Abilities: tap one to spend Command Energy (CE), then tap the field.' },
  { id: 'boons', feature: 'boons', icon: 'boon', text: 'Boons help until the tower falls. Pick one, or decline.' },
  { id: 'anomalies', feature: 'anomalies', icon: 'info', text: 'Anomaly drafts follow bosses: each card bends the rules until you Prestige.' },
  { id: 'bulk', feature: 'bulk', icon: 'upgrade', text: 'Upgrades now suggests buys: Buy all, or ×10 and Max per tap.' },
  { id: 'prestige', feature: 'prestigeTab', icon: 'prestige', text: 'Something is coming. The Prestige tab shows when rebuilding pays off.' },
  { id: 'machine', feature: 'quartermaster', icon: 'more', text: 'A new machine: every tab stays open. New weapons and elements arrive with later Prestiges; Automation and Trials unlock in More.' },
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
 * The message to show now, or null, among unread messages whose feature is on: an event explainer whose subject is
 * live (a boon offer, an Anomaly draft) first; else the NEWEST stage message (an older unread one is stale: reading
 * the newer one retires it, see staleWith); else an event explainer (the active-edge ones only while their subject is live).
 */
export function pendingCoach(f: Features, seen: ReadonlySet<string>, live: CoachLive = { boonOffer: false, draft: false }): CoachMsg | null {
  if (f.unlockAll) return null;
  const liveNow = (m: CoachMsg): boolean => (m.id === 'salvage' && !!live.crate) || (m.id === 'overcharge' && !!live.overchargeReady);
  const open = COACH.filter((m) => f[m.feature] && !seen.has(m.id) && (!LIVE_COACH.has(m.id) || liveNow(m)));
  if (!open.length) return null;
  const urgent = open.find((m) => (m.id === 'boons' && live.boonOffer) || (m.id === 'anomalies' && live.draft));
  const stage = open.filter((m) => !EVENT_COACH.has(m.id));
  return urgent ?? stage[stage.length - 1] ?? open[0];
}

/** Reading `id` also retires these: the older stage messages (an event explainer retires only itself). */
export function staleWith(id: CoachId): CoachId[] {
  if (EVENT_COACH.has(id)) return [id];
  const i = COACH.findIndex((m) => m.id === id);
  return COACH.slice(0, i + 1).filter((m) => !EVENT_COACH.has(m.id)).map((m) => m.id);
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
export interface CoachExtra { id: string; icon: string; text: string; action?: { label: string; run: () => void } }

/** An info-only line (no action button) shrinks to one line after this long on screen (ms); a tap on it expands it again. */
export const COACH_SHRINK_MS = 6000;

export class CoachBanner {
  readonly el: HTMLElement;
  private readonly ico = h('span', { class: 'coach-ico' });
  private readonly msg = h('span', { class: 'coach-text' });
  private readonly act: HTMLButtonElement;
  private cur: CoachMsg | null = null;
  private extra: CoachExtra | null = null;
  private shrinkTimer = 0;
  /** Shrunk by its timer (info-only lines): the overlay lanes give it the one-line height (lanes.ts). */
  shrunk = false;
  /** Called when the banner changes (a new line, shown / hidden, shrunk / expanded): the overlay lanes re-fit. */
  onChange: (() => void) | null = null;
  constructor() {
    const ok = button('Got it', () => this.dismiss(), { class: 'btn small coach-ok' });
    this.act = button('', () => { const x = this.extra; this.dismiss(); x?.action?.run(); }, { class: 'btn small primary coach-act' });
    this.act.hidden = true;
    this.el = h('div', { class: 'coach-banner', attrs: { role: 'status', 'aria-live': 'polite' } }, this.ico, this.msg, this.act, ok);
    this.el.hidden = true;
    // a one-line (compact) banner opens again on a tap on its text
    this.msg.addEventListener('click', () => { if (this.el.classList.contains('compact')) this.expand(); });
  }

  get current(): CoachId | null { return this.cur?.id ?? null; }

  /** `extras` wait behind the ladder; `hold` ids count as read for now (e.g. 'machine' while the Echo guide runs). */
  update(f: Features, live: CoachLive, extras: readonly CoachExtra[] = [], hold: readonly string[] = []): void {
    const seen = new Set([...prefs().coachSeen, ...hold]);
    const next = pendingCoach(f, seen, live);
    if (!next && !f.unlockAll && !(this.cur && LIVE_COACH.has(this.cur.id) && !seen.has(this.cur.id))) {
      const x = extras.find((e) => !seen.has(e.id)) ?? null;
      if (x || this.extra) { this.showExtra(x); return; }
    } else if (this.extra) { this.extra = null; this.act.hidden = true; }
    if (next?.id === this.cur?.id) { if (next && this.el.hidden) { show(this.el, true); this.fresh(); } return; }
    // a live explainer stays up until read, even after its crate is gone (unless something else is due)
    if (!next && this.cur && LIVE_COACH.has(this.cur.id) && !seen.has(this.cur.id) && !f.unlockAll) return;
    this.cur = next;
    show(this.el, !!next);
    if (!next) { this.fresh(); return; }
    this.ico.replaceChildren(icon(next.icon, 'ico'));
    text(this.msg, next.text);
    this.el.dataset.coach = next.id;
    // replay the entrance for each new message
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.fresh();
  }

  private showExtra(x: CoachExtra | null): void {
    this.cur = null;
    if (x?.id === this.extra?.id && x?.text === this.extra?.text) return;
    this.extra = x;
    show(this.el, !!x);
    this.act.hidden = !x?.action;
    if (!x) { this.fresh(); return; }
    text(this.act, x.action?.label ?? '');
    this.ico.replaceChildren(icon(x.icon, 'ico'));
    text(this.msg, x.text);
    this.el.dataset.coach = x.id;
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.fresh();
  }

  /** A new line (or the banner shown / hidden): full size again; an info-only line shrinks after COACH_SHRINK_MS. */
  private fresh(): void {
    clearTimeout(this.shrinkTimer);
    this.shrunk = false;
    if (!this.el.hidden && this.act.hidden) this.shrinkTimer = window.setTimeout(() => { this.shrunk = true; this.onChange?.(); }, COACH_SHRINK_MS);
    this.onChange?.();
  }

  /** Tap on a one-line banner: the whole sentence again (it shrinks back after COACH_SHRINK_MS). */
  expand(): void { this.fresh(); }

  dismiss(): void {
    if (this.extra) { markCoachSeen([this.extra.id]); this.extra = null; this.act.hidden = true; show(this.el, false); this.fresh(); return; }
    const id = this.cur?.id;
    if (!id) return;
    markCoachSeen(staleWith(id));
    this.cur = null;
    show(this.el, false);
    this.fresh();
  }
}

export function markCoachSeen(ids: readonly string[]): void {
  const seen = new Set(prefs().coachSeen);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) setPref('coachSeen', [...seen]);
}

