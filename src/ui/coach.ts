/**
 * Just-in-time coach banners (they replace the old three intro cards): one short sentence the moment a
 * feature is revealed (src/ui/progression.ts), in a small non-blocking banner with "Got it". Never a
 * modal. Which ones were read is per-device presentation state in prefs (coachSeen); what is revealed
 * never depends on it. Help lists every message the player has unlocked and can replay them.
 */
import '../styles/coach.css';
import { button, h, show, text } from './dom';
import { icon } from './icons';
import { prefs, setPref } from './prefs';
import type { FeatureId, Features } from './progression';

export type CoachId = 'start' | 'checkpoint' | 'elements' | 'build' | 'abilities' | 'boons' | 'anomalies' | 'bulk' | 'prestige' | 'machine';

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
  { id: 'machine', feature: 'quartermaster', icon: 'more', text: 'A new machine. Automation and Trials open in More as you earn them.' },
];

/** What makes a message urgent right now (its thing is on screen): it jumps the queue. */
export interface CoachLive { boonOffer: boolean; draft: boolean }

/**
 * The message to show now, or null: an unread message whose feature is on, those whose subject is live
 * (a boon offer, an Anomaly draft) first, else the earliest in reveal order.
 */
export function pendingCoach(f: Features, seen: ReadonlySet<string>, live: CoachLive = { boonOffer: false, draft: false }): CoachMsg | null {
  if (f.unlockAll) return null;
  const open = COACH.filter((m) => f[m.feature] && !seen.has(m.id));
  if (!open.length) return null;
  const urgent = open.find((m) => (m.id === 'boons' && live.boonOffer) || (m.id === 'anomalies' && live.draft));
  return urgent ?? open[0];
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

export class CoachBanner {
  readonly el: HTMLElement;
  private readonly ico = h('span', { class: 'coach-ico' });
  private readonly msg = h('span', { class: 'coach-text' });
  private cur: CoachMsg | null = null;

  constructor() {
    const ok = button('Got it', () => this.dismiss(), { class: 'btn small coach-ok' });
    this.el = h('div', { class: 'coach', attrs: { role: 'status', 'aria-live': 'polite' } }, this.ico, this.msg, ok);
    this.el.hidden = true;
  }

  get current(): CoachId | null { return this.cur?.id ?? null; }

  update(f: Features, live: CoachLive): void {
    const next = pendingCoach(f, new Set(prefs().coachSeen), live);
    if (next?.id === this.cur?.id) return;
    this.cur = next;
    show(this.el, !!next);
    if (!next) return;
    this.ico.replaceChildren(icon(next.icon, 'ico'));
    text(this.msg, next.text);
    this.el.dataset.coach = next.id;
    // replay the entrance for each new message
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
  }

  dismiss(): void {
    const id = this.cur?.id;
    if (!id) return;
    markCoachSeen([id]);
    this.cur = null;
    show(this.el, false);
  }
}

export function markCoachSeen(ids: readonly string[]): void {
  const seen = new Set(prefs().coachSeen);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) setPref('coachSeen', [...seen]);
}

/** Help → "Show tips again": every unlocked message replays, one at a time. */
export function resetCoach(): void { setPref('coachSeen', []); }
