/**
 * The attention plan (docs/reviews/HANDBOOK-EVAL.md Phase 1, items 2–4): which of Battle's transient overlays may ask for
 * the player's attention right now, so a death or a boss clear is one clear beat and then one decision at a time.
 *
 *   death first   for DEATH_FIRST_MS after the tower falls (or while the player asked for the whole card) the death card
 *                 owns the lane: the start-of-attempt boon offer waits as its "Boon ready" chip, the coach is held
 *   celebration   for CELEBRATE_MS after a boss kill: one summary toast (feed.ts), no decision UI, no coach, no rings
 *   decisions     then one at a time: the Anomaly draft first, then the boon offer (the other waits as its chip / badge);
 *                 coach lines and pointer rings wait until the queue is empty (an explainer of the decision on screen may
 *                 stay beside it)
 *   boss mode     during a live boss fight: the offer folds to its chip, the coach is held, the starter glow and the
 *                 pointer hints pause, so the boss and its tell are clear
 *
 * planAttention is pure (tests/ui/attention.test.ts); Attention applies it to the components every UiState (index.ts).
 */
import '../styles/attention.css';
import type { UiState } from '@sim/core/types';
import type { CoachBanner } from './coach';
import type { DeathCard } from './death';
import type { Feed } from './feed';
import type { BoonOffer } from './boons';
import type { DraftModal } from './draft';
import type { UiHost } from './host';
import { button } from './dom';
import { icon } from './icons';

/** The death card owns the lane this long after a death (ms). */
export const DEATH_FIRST_MS = 8000;
/** The boss-clear beat: no decision UI, coach or rings for this long after the kill (ms). */
export const CELEBRATE_MS = 1800;
/** Coach lines and pointer rings wait this long after a boss kill, so they never share the screen with the summary toast. */
export const CLEAR_COACH_MS = 4000;

export interface AttnInput {
  now: number;
  /** performance.now() when the death card opened, or null when it is not showing (hidden or folded). */
  deathShownAt: number | null;
  /** The player asked for the whole death card (a tap on its folded headline). */
  deathWantFull: boolean;
  /** performance.now() of the last boss kill (-Infinity: none). */
  bossClearAt: number;
  /** An Anomaly draft is pending and not set aside with "Later". */
  draftWaiting: boolean;
  /** A boon offer is pending (shown or as its chip). */
  offerPending: boolean;
  /** A boss fight is live (a boss wave in combat with the boss alive). */
  liveBoss: boolean;
  /** The first-Prestige rebuild beat is playing (ceremony.ts playRebuildBeat): nothing else asks for attention. */
  rebuilding?: boolean;
}

export interface AttnPlan {
  deathFirst: boolean;
  celebrate: boolean;
  bossMode: boolean;
  /** The rebuild beat: coach, toasts, hints and decisions all wait. */
  beat: boolean;
  /** The decision on screen now (null: none, or held). */
  decision: 'draft' | 'boon' | null;
  /** The boon offer shows only as its chip. */
  offerHeld: boolean;
  /** The draft dialog waits (it is still pending: the Build tab badge). */
  draftHeld: boolean;
  /** Coach lines wait (an explainer of `decision` excepted: see coachHeld()). */
  coachHeld: boolean;
  /** Pointer rings and the starter glow pause. */
  hintsHeld: boolean;
}

export function planAttention(i: AttnInput): AttnPlan {
  const deathFirst = i.deathShownAt !== null && (i.deathWantFull || i.now - i.deathShownAt < DEATH_FIRST_MS);
  const celebrate = i.now - i.bossClearAt < CELEBRATE_MS;
  const bossMode = i.liveBoss;
  const beat = !!i.rebuilding;
  const quiet = deathFirst || celebrate || bossMode || beat;
  const decision = quiet ? null : i.draftWaiting ? 'draft' : i.offerPending ? 'boon' : null;
  const afterClear = i.now - i.bossClearAt < CLEAR_COACH_MS;
  return {
    deathFirst, celebrate, bossMode, beat, decision,
    offerHeld: quiet || decision === 'draft',
    draftHeld: quiet,
    coachHeld: quiet || afterClear || decision !== null,
    hintsHeld: quiet || afterClear || decision !== null,
  };
}

/** Is the coach line `id` held under `p`? An explainer of the decision on screen stays beside it. */
export function coachHeld(p: AttnPlan, id: string | null): boolean {
  if (!p.coachHeld) return false;
  if (p.beat) return true;
  if (p.decision === 'boon' && id === 'boons') return false;
  if (p.decision === 'draft' && id === 'anomalies') return false;
  return true;
}

/** A boss fight is live: a boss wave in combat with the boss alive. */
export function liveBoss(ui: Pick<UiState, 'wave' | 'run'>): boolean {
  return ui.wave.isBoss && ui.run.phase === 'combat' && ui.wave.bossHp > 0;
}

/** The wave token for the coach queue's one-new-line-per-wave-clear limit. */
export function waveToken(ui: Pick<UiState, 'run' | 'meta'>): number {
  return ui.meta.prestigeCount * 100000 + ui.run.wave;
}

export interface AttnParts {
  death: DeathCard;
  feed: Feed;
  offer: BoonOffer;
  draft: DraftModal;
  coach: CoachBanner;
  /** The arena is on screen (phone: the Battle tab; desktop: always). */
  battleVisible(): boolean;
  /** The worker host (the "Update ready · Restart" chip: updateReady / applyUpdate). Optional. */
  host?: UiHost;
  /** Something changed that the overlay lanes and pointer hints should re-fit to. */
  changed(): void;
}

/** The rebuild beat is playing (set by ceremony.ts playRebuildBeat; read by Attention.update). */
let rebuildBeatOn = false;
export function setRebuildBeat(on: boolean): void { rebuildBeatOn = on; }
export function rebuildBeatPlaying(): boolean { return rebuildBeatOn; }

export class Attention {
  plan: AttnPlan = planAttention({ now: 0, deathShownAt: null, deathWantFull: false, bossClearAt: -Infinity, draftWaiting: false, offerPending: false, liveBoss: false });
  private key = '';

  /**
   * "Update ready · Restart": a persistent chip in the arena-strip (beside the boon chip) while a new version waits; the
   * page never reloads under the player (app/game.ts), a tap restarts into it.
   */
  readonly updateChip: HTMLButtonElement;

  constructor(private readonly p: AttnParts) {
    this.updateChip = button([icon('restart', 'ico tiny'), 'Update ready · Restart'], () => p.host?.applyUpdate?.(), { class: 'btn ctl update-chip', label: 'A new version is ready: restart into it' });
    this.updateChip.hidden = true;
    p.offer.chip.parentElement?.insertBefore(this.updateChip, p.offer.chip.nextSibling);
    if (typeof window !== 'undefined') window.addEventListener('citadel:update-ready', () => this.syncUpdate());
  }

  private syncUpdate(): void {
    const on = !!this.p.host?.updateReady?.();
    if (on === !this.updateChip.hidden) return;
    this.updateChip.hidden = !on;
    this.p.changed();
  }

  /** Pointer rings and hints wait (HintDriver `blocked`). */
  get hintsHeld(): boolean { return this.plan.hintsHeld; }

  /** Every UiState (before the components update) and on the fold / dismiss of the death card. */
  update(ui: UiState, now = performance.now()): void {
    this.syncUpdate();
    const P = this.p, d = P.death;
    const plan = planAttention({
      now,
      deathShownAt: d.visible && !d.folded ? d.shownAt : null,
      deathWantFull: d.wantFull,
      bossClearAt: P.feed.bossClearAt,
      draftWaiting: P.draft.waiting,
      offerPending: !!ui.run.boonOffer?.length,
      liveBoss: liveBoss(ui),
      rebuilding: rebuildBeatOn,
    });
    this.plan = plan;
    d.first = plan.deathFirst;
    P.offer.setHeld(plan.offerHeld);
    P.draft.setHeld(plan.draftHeld);
    P.coach.setWave(waveToken(ui));
    P.coach.setHeld(coachHeld(plan, P.coach.currentId));
    const c = P.coach.el;
    P.coach.sample(P.battleVisible() && !c.hidden && !c.classList.contains('lane-wait'), now);
    const b = document.body.classList;
    b.toggle('attn-boss', plan.bossMode);
    b.toggle('attn-quiet', plan.hintsHeld);
    b.toggle('attn-beat', plan.beat);
    const key = `${plan.deathFirst}|${plan.celebrate}|${plan.bossMode}|${plan.beat}|${plan.decision}`;
    if (key !== this.key) { this.key = key; P.changed(); }
  }
}
