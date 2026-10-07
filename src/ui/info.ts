/**
 * Tap to explain. A touch screen has no hover, so an explanation that lives in a `title` is never seen on a phone. Any
 * element with `data-info="<key>"` opens a small info sheet when tapped (a bottom sheet on phones, a small card on
 * desktop; tap outside, Esc, the close button or Back dismisses it: the modal layer does all four). `INFO` is the one
 * table of explanations (one or two plain sentences each); Help's "What is…" list is built from it, filtered to the
 * features the player has been shown (a glossary must not name a system that has not been revealed yet).
 *
 * For a control that already has a tap action (Push / Patrol, speed), `infoOnHold` opens the sheet on a long press
 * instead, and Help lists the same text.
 */
import '../styles/info.css';
import { button, h, longPress } from './dom';
import { openModal, type ModalHandle } from './modal';
import type { FeatureId, Features } from './progression';

export interface InfoEntry {
  title: string;
  /** One or two plain sentences. */
  text: string;
  /** Listed in Help's glossary once this feature is revealed (no feature: always). */
  feature?: FeatureId;
  /** What the sheet says while `feature` is not revealed yet (a chip can show before what it buys does). */
  early?: string;
  /** Not listed in the glossary (a readout whose words are already the title). */
  hideInGlossary?: boolean;
}

export const INFO: Readonly<Record<string, InfoEntry>> = {
  scrap: { title: 'Scrap', text: 'Scrap pays for upgrades. Every kill banks some, and it is kept when the tower falls.' },
  cores: { title: 'Cores', feature: 'cores', early: 'Cores drop from bosses. They are a second currency for bigger commitments; you will meet what they buy as you climb.', text: 'Cores drop from bosses. They pay for Exotics, Refits, Doctrine changes and Anomaly rerolls, and they reset when you Prestige.' },
  qmBank: { title: 'Quartermaster bank', feature: 'quartermaster', text: 'The Quartermaster sets aside its share of your Scrap income and spends only that, on your stat upgrades.' },
  mode: { title: 'Push and Patrol', feature: 'runControls', text: 'Push climbs on and fights each boss. Patrol loops the four waves after your checkpoint: it is safe, and it is what earns Scrap while you are away. Long-press the chip for this note; a tap switches.' },
  speed: { title: 'Speed', feature: 'runControls', text: 'Cycles the game speed. Only waves you have already solved can run faster. Long-press the chip for this note; a tap changes the speed.' },
  designators: { title: 'Designators', feature: 'abilities', text: 'Tap an enemy to focus fire on it. You hold two marks: a third tap replaces the older one, and tapping a marked enemy clears it.' },
  ce: { title: 'Command Energy', feature: 'abilities', text: 'CE fills as you fight and pays for abilities. The ticks on the bar show what each ability costs.' },
  checkpoint: { title: 'Checkpoint', feature: 'upgradesTab', text: 'Each boss you clear is a checkpoint. If the tower falls, it restarts the climb from the last one, and keeps its upgrades and Scrap.' },
  echoes: { title: 'Echoes', feature: 'prestigeTab', text: 'Echoes are what a Prestige pays out. You spend them on permanent upgrades in the Echo tiers, and they are never lost.' },
  echoTiers: { title: 'Echo tiers', feature: 'prestigeTab', text: 'The Echo upgrades come in four tiers, I to IV. A tier opens once your deepest wave ever reaches its number; after that, each upgrade is bought with Echoes. This is not your Prestige count.' },
  frontier: { title: 'The Frontier', feature: 'forecast', text: 'Past this wave enemies harden fast, so the climb slows to a wall. Each Prestige moves the Frontier deeper.' },
  'fc.echoesNow': { title: 'Echoes now', feature: 'forecast', text: 'The Echoes you would get if you Prestiged this second.' },
  'fc.rate': { title: 'Echo rate', feature: 'forecast', text: 'Echoes now divided by the hours since this Prestige began. When it stops rising, a fresh start pays better than pushing on.' },
  'fc.next': { title: 'Next boss', feature: 'forecast', text: 'What the Echoes and the rate would be after the next checkpoint, if you reach it at your recent pace.' },
  'fc.reclimb': { title: 'Reclimb', feature: 'forecast', text: 'About how long a new Prestige would need to get back to this depth. It is shorter than the first climb.' },
  'fc.wall': { title: 'Wall gauge', feature: 'forecast', text: 'How long until you can afford the next upgrade that changes how the tower behaves, at your current Scrap income. "Now" means you can buy it already.' },
  frame: { title: 'Frame', feature: 'frame', text: 'Your Frame is the machine\'s body: how many weapon and element slots it has and what it does for free. A new Frame is chosen when you Prestige.' },
  boons: { title: 'Boons', feature: 'boons', text: 'A Boon helps until the tower falls. Pick one of the offers, or decline.' },
  anomalies: { title: 'Anomalies', feature: 'anomalies', text: 'After a boss you may draft an Anomaly. Each one bends the rules in your favour at a price, until you Prestige.' },
  hardpoints: { title: 'Hardpoints', feature: 'hardpoints', text: 'A hardpoint slot mounts one weapon system. Mounting it opens that system\'s upgrade tree in Upgrades → Hardpoints.' },
  attunements: { title: 'Attunements', feature: 'elements', text: 'An attunement slot binds one element to the tower. Attuning it opens that element\'s upgrade tree in Upgrades → Elements.' },
  abilities: { title: 'Abilities', feature: 'abilities', text: 'Abilities are slotted powers you cast from the Battle bar. Each costs Command Energy and then cools down.' },
  doctrines: { title: 'Doctrines', feature: 'buildTab', text: 'A Doctrine is a path you choose for a tree once enough of its core upgrades are owned. It sets how that tree plays.' },
  salvage: { title: 'Salvage crates', feature: 'salvage', text: 'Glowing crates drift toward the tower: tap one for bonus Scrap (missed ones still pay half). Every boss kill spills 3 to 5, so tap them fast to chain a bigger bonus.' },
  quartermaster: { title: 'Quartermaster', feature: 'quartermaster', text: 'An optional helper that buys stat upgrades for you with a share of your income. It never picks Boons, elements or weapons.' },
};

/** The keys the code uses (tests check every one has text). */
export const INFO_KEYS = Object.keys(INFO);

/** Glossary entries for the features revealed so far (Help's "What is…"). Pure. */
export function glossary(f: Pick<Features, FeatureId> | Features): { key: string; title: string; text: string }[] {
  return INFO_KEYS.filter((k) => !INFO[k].hideInGlossary && (!INFO[k].feature || f[INFO[k].feature!]))
    .map((k) => ({ key: k, title: INFO[k].title, text: INFO[k].text }));
}

// ---------------------------------------------------------------- the sheet

let current: ModalHandle | null = null;
let feats: Pick<Features, FeatureId> | null = null;
/** The revealed features (the HUD hands them over): a sheet never names what the player has not been shown. */
export function setInfoFeatures(f: Pick<Features, FeatureId>): void { feats = f; }
/** The text the sheet shows for `key` now. */
export function infoText(key: string): string {
  const e = INFO[key];
  if (!e) return '';
  return e.early && e.feature && feats && !feats[e.feature] ? e.early : e.text;
}

/**
 * Open the info sheet for `key` (an unknown key does nothing). `more`: a screen's own rule for this place, shown under
 * the entry's text (Build's section notes ride on their ⓘ as `data-info-more`).
 */
export function openInfo(key: string, more?: string | null): void {
  const e = INFO[key];
  if (!e) return;
  current?.close();
  const ok = button('Got it', () => m.close(), { class: 'btn primary wide info-ok' });
  const body = h('div', null, h('p', { class: 'info-text', text: infoText(key) }), more ? h('p', { class: 'info-text info-more', text: more }) : null);
  const m = openModal({
    title: e.title, body, footer: ok,
    className: 'info-sheet', variant: 'sheet', onClose: () => { if (current === m) current = null; },
  });
  current = m;
}

/** Make `el` open the info sheet on tap (keyboard: Enter / Space). Adds the button role and the info mark's attributes. */
export function markInfo<T extends HTMLElement>(el: T, key: string): T {
  el.dataset.info = key;
  if (!el.hasAttribute('tabindex') && el.tagName !== 'BUTTON') el.tabIndex = 0;
  if (el.tagName !== 'BUTTON' && !el.hasAttribute('role')) el.setAttribute('role', 'button');
  return el;
}

/**
 * A control that already acts on tap: a long press (or the context menu) opens the info sheet instead. The returned
 * `consumed()` is true right after a long press: the control's click handler must return early then.
 */
export function infoOnHold(el: HTMLElement, key: string): { consumed(): boolean } {
  el.dataset.infoHold = key;
  return longPress(el, 500, () => openInfo(key));
}

if (typeof document !== 'undefined') {
  const keyOf = (t: EventTarget | null): string | null => {
    const el = (t as Element | null)?.closest?.('[data-info]') as HTMLElement | null;
    return el && !el.closest('.info-sheet') ? el.dataset.info ?? null : null;
  };
  const moreOf = (t: EventTarget | null): string | null => ((t as Element | null)?.closest?.('[data-info]') as HTMLElement | null)?.dataset.infoMore ?? null;
  document.addEventListener('click', (e) => { const k = keyOf(e.target); if (k) openInfo(k, moreOf(e.target)); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName === 'BUTTON' || t.tagName === 'INPUT') return;
    const k = keyOf(t);
    if (k && t.dataset.info) { e.preventDefault(); openInfo(k, moreOf(t)); }
  });
}
