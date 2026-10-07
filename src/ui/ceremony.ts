/**
 * First-Prestige ceremony (docs/ONBOARDING.md). The first Prestige is a story beat at the Frontier (wave ~28), not a
 * form: a short, warm modal says what you earn (the Forecast's exact Echoes), what resets and what stays (one sentence
 * each), where the Frontier moves, and has one primary button. Afterwards the Prestige tab opens on its Layer I picks
 * with a guide line ("Spend your Echoes…"); the affordable picks are highlighted (a class only). Nothing is ever
 * bought for the player. Second and later Prestiges use the full Prestige modal (prestige.ts). UX Phase 2: both lead with the Forecast verdict
 * (prestigeVerdict), and the guide marks ONE suggested pick (echoGuideSuggested).
 *
 * The guide flag lives in prefs (presentation state): it ends on "Got it", or once nothing in Layer I is affordable.
 */
import '../styles/ceremony.css';
import type { TreeId } from '@sim/core/ids';
import type { Command, UiState } from '@sim/core/types';
import { button, h } from './dom';
import { icon } from './icons';
import { echoesFor, fmtNum, nextRankCost } from './format';
import { ELEMENTS, PRESTIGE_NODES, TREE_LABEL } from './content';
import { openModal } from './modal';
import { prefs, setPref } from './prefs';
import type { UiCtx } from './ctx';
import type { CoachExtra } from './coach';
import { echoesAfter, walletChip } from './wallet';
import { setRebuildBeat } from './attention';

export const CEREMONY_TITLE = 'Your first Prestige';
export const CEREMONY_RESETS = 'Scrap, upgrades and the wave reset (this run\'s Cores and Anomalies too): you start again at wave 1.';
export const CEREMONY_KEEPS = 'You keep your Echoes, the Codex, your records and everything permanent.';
export const ECHO_GUIDE_TEXT = 'Spend your Echoes: these make every run stronger.';
/** Layer I opens at deepest-ever wave 20 (prestige-shop.ts LAYERS). */
const LAYER1_WAVE = 20;

type CeremonyState = Pick<UiState, 'meta' | 'forecast' | 'run'> & Partial<Pick<UiState, 'activeTrial'>>;

export interface PrestigeVerdict {
  recommended: boolean;
  /** "Recommended now" or "Waiting ~6 min likely adds +12 Echoes" (or a plain fallback without a Forecast). */
  headline: string;
  /** "Next boss (wave 30): +55 Echoes" or null. */
  nextBoss: string | null;
  /** "Frontier: wave 28 → 38" or null. */
  frontier: string | null;
  /** The next boss wave when it would add Echoes, else null. */
  bossWave: number | null;
}

/** The modal's lead lines, from the Forecast (pure; tests and e2e). */
export function prestigeVerdict(ui: Pick<UiState, 'forecast' | 'run'>): PrestigeVerdict {
  const f = ui.forecast;
  if (!f) return { recommended: false, headline: 'No Forecast yet', nextBoss: null, frontier: null, bossWave: null };
  const nextCp = (Math.floor(ui.run.deepestCleared / 5) + 1) * 5;
  const gain = Math.max(0, f.nextBossEchoes - f.echoesNow);
  const nextBoss = gain > 0 ? `Next boss (wave ${nextCp}): +${fmtNum(gain)} Echoes` : null;
  const frontier = f.frontier !== undefined && f.nextFrontier !== undefined && f.nextFrontier > f.frontier ? `Frontier: wave ${f.frontier} → ${f.nextFrontier}` : null;
  const bossWave = gain > 0 ? nextCp : null;
  if (f.recommended) return { recommended: true, headline: 'Recommended now', nextBoss, frontier, bossWave };
  let headline = 'Not recommended yet: your Echo rate is still rising';
  if (gain > 0 && f.nextBossRate > 0) {
    const at = (f.nextBossEchoes * 3600) / f.nextBossRate;
    const mins = Math.max(1, Math.round((at - ui.run.playSeconds) / 60));
    headline = `Waiting ~${mins} min likely adds +${fmtNum(gain)} Echoes`;
  }
  return { recommended: false, headline, nextBoss, frontier, bossWave };
}

/** The ceremony replaces the full modal only for a plain first Prestige (nothing to choose yet) without Unlock everything. */
export function useCeremony(ui: Pick<UiState, 'meta'>, unlockAll: boolean): boolean {
  const m = ui.meta;
  return !unlockAll && (m.prestigeCount | 0) === 0 && m.unlockedFrames.length <= 1 && m.blueprints.length === 0 && Object.values(m.prestigeRanks).every((r) => !r);
}

export interface CeremonyFacts {
  echoes: number;
  gain: string;
  resets: string;
  keeps: string;
  /** "The Frontier moves from wave 28 to wave 38." (null without Forecast data). */
  frontier: string | null;
  cta: string;
}

/** What the modal says, from the Forecast (exact Echoes) with the formula as the fallback. Pure (tests). */
export function ceremonyFacts(ui: CeremonyState): CeremonyFacts {
  const f = ui.forecast;
  const echoes = f?.echoesNow ?? echoesFor(ui.run.deepestCleared, ui.run.threatDial);
  const moves = f?.frontier !== undefined && f.nextFrontier !== undefined && f.nextFrontier > f.frontier;
  return {
    echoes,
    gain: echoes > 0 ? `+${fmtNum(echoes)} Echoes` : 'No Echoes yet',
    resets: CEREMONY_RESETS,
    keeps: CEREMONY_KEEPS,
    frontier: moves ? `The Frontier moves from wave ${f!.frontier} to wave ${f!.nextFrontier}.` : null,
    cta: echoes > 0 ? `Prestige for ${fmtNum(echoes)} Echoes` : 'Prestige',
  };
}

/** Layer I picks the player can afford right now (node ids, content order). Pure (tests). */
export function echoGuidePicks(ui: Pick<UiState, 'meta'>): string[] {
  const m = ui.meta;
  if ((m.deepestEver | 0) < LAYER1_WAVE) return [];
  return PRESTIGE_NODES.filter((d) => d.layer === 1).filter((d) => {
    const rank = m.prestigeRanks[d.id] | 0;
    return rank < d.maxRank && m.echoes >= nextRankCost(d.cost, rank);
  }).map((d) => d.id);
}

/**
 * The ONE suggested first pick (UX Phase 2 item 5), derived from the data: among the affordable Layer I picks, the one
 * that changes behaviour (a mechanic, maxRank ≤ 5: Accelerated Clearing) before stat ranks; ties go to the cheapest,
 * then content order. Only a marker: every affordable pick stays buyable and nothing is bought for the player.
 */
export function echoGuideSuggested(ui: Pick<UiState, 'meta'>): string | null {
  const picks = echoGuidePicks(ui);
  if (!picks.length) return null;
  const m = ui.meta;
  const defs = picks.map((id) => PRESTIGE_NODES.find((d) => d.id === id)!).filter(Boolean);
  const score = (d: (typeof PRESTIGE_NODES)[number]): [number, number] => [d.kind === 'mechanic' ? 0 : 1, nextRankCost(d.cost, m.prestigeRanks[d.id] | 0)];
  let best = defs[0];
  for (const d of defs.slice(1)) {
    const a = score(d), b = score(best);
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best = d;
  }
  return best.id;
}

/** "Suggested: Accelerated Clearing" for the guide line (null when nothing is affordable). */
export function echoGuideSuggestedText(ui: Pick<UiState, 'meta'>): string | null {
  const id = echoGuideSuggested(ui);
  const d = id ? PRESTIGE_NODES.find((x) => x.id === id) : undefined;
  return d ? `Suggested: ${d.name}` : null;
}

/** The guide is over once the Prestige has landed and nothing in Layer I is affordable. */
export function echoGuideDone(ui: Pick<UiState, 'meta'>): boolean {
  return (ui.meta.prestigeCount | 0) >= 1 && echoGuidePicks(ui).length === 0;
}

export function echoGuideOn(): boolean { return prefs().echoGuide; }
export function endEchoGuide(): void { if (prefs().echoGuide) setPref('echoGuide', false); }

/** The first-Prestige modal. Confirm sends the Prestige, saves, and opens the Prestige tab's Layer I with the guide. */
export function openCeremony(ctx: UiCtx): void {
  const ui = ctx.state();
  if (!ui) return;
  const fx = ceremonyFacts(ui);
  const v = prestigeVerdict(ui);
  const line = (ico: string, cls: string, text: string): HTMLElement => h('li', { class: `cer-line ${cls}` }, icon(ico, 'ico'), h('span', { text }));
  const body = h('div', { class: 'ceremony' },
    h('p', { class: 'cer-lead', text: `You pushed the machine to wave ${ui.run.deepestCleared}. Rebuild it stronger.` }),
    h('div', { class: 'cer-gain' }, icon('echo', 'ico big'), h('span', { class: 'cer-gain-val', text: fx.gain })),
    h('p', { class: 'cer-sub', text: 'Echoes buy upgrades that make every run stronger.' }),
    // UX Phase 2: the Forecast verdict and the next boss, so "now or wait" is answered here too
    h('p', { class: `cer-verdict${v.recommended ? ' rec' : ''}`, attrs: { role: 'status' } }, icon(v.recommended ? 'check' : 'forecast', 'ico tiny'),
      h('span', { text: !v.recommended && v.bossWave !== null && v.headline.startsWith('Waiting') ? `${v.headline} (the wave ${v.bossWave} boss)` : v.headline })),
    h('ul', { class: 'cer-lines' },
      line('restart', 'resets', fx.resets),
      line('check', 'keeps', fx.keeps),
      fx.frontier ? line('prestige', 'frontier', fx.frontier) : null));
  const go = button([icon('prestige'), fx.cta], () => {
    const frames = ui.meta.unlockedFrames.length ? ui.meta.unlockedFrames : ['standard' as const];
    const cmd: Extract<Command, { type: 'prestige' }> = { type: 'prestige', frame: frames.includes(ui.build.frame) ? ui.build.frame : frames[0] };
    // UX Phase 4 (C-19): the rebuild beat copies the old tower from the current snapshot, so it starts before the send
    const beatMs = ctx.host.rebuildBeat?.() ?? 0;
    ctx.host.send(cmd);
    ctx.host.saveNow();
    setPref('echoGuide', true);
    m.close();
    if (beatMs > 0) playRebuildBeat(ctx, beatMs, () => ctx.open('prestige_shop'));
    else ctx.open('prestige_shop');
  }, { class: 'btn primary wide cer-go' });
  const m = openModal({ title: CEREMONY_TITLE, body, footer: go, className: 'ceremony-modal',
    wallet: walletChip(['echoes'], ui, echoesAfter(fx.echoes)) });
}

/** The rebuild beat's skip layer (tests): a full-screen tap target over Battle while the beat plays. */
export const REBUILD_SKIP_CLASS = 'rebuild-skip';

/**
 * UX Phase 4 (C-19): after the first Prestige, Battle shows for ~2.5 s while the old tower dissolves and the new hull
 * assembles (render/moments.ts; a short crossfade under reduced motion), then `then` runs (the Echo guide). A tap
 * anywhere, Esc or Enter skips it. The renderer started the beat already (host.rebuildBeat); this is the UI side.
 */
export function playRebuildBeat(ctx: UiCtx, ms: number, then: () => void): void {
  ctx.open('battle');
  let done = false;
  const skip = h('button', { class: REBUILD_SKIP_CLASS, attrs: { type: 'button', 'aria-label': 'Skip the rebuild' } },
    h('span', { class: 'rebuild-skip-label', text: 'Rebuilding the machine · tap to skip' }));
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); finish(); } };
  const finish = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey, true);
    skip.remove();
    setRebuildBeat(false);
    ctx.host.endRebuildBeat?.();
    then();
  };
  skip.addEventListener('click', finish);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(skip);
  setRebuildBeat(true);
  const timer = window.setTimeout(finish, ms + 120);
}

// ---------------------------------------------------------------- post-Prestige coach lines (index.ts feeds CoachBanner)

const isElementId = (id: string): boolean => (ELEMENTS as string[]).includes(id);

/** "New: Frost joins your arsenal. Look for the New tag when you attune." (content pool, progression.ts). Pure (tests). */
export function newContentCoach(ids: readonly string[]): CoachExtra | null {
  if (!ids.length) return null;
  const names = ids.map((id) => TREE_LABEL[id as TreeId] ?? id);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const els = ids.some(isElementId), hps = ids.some((id) => !isElementId(id));
  const verb = els && hps ? 'attune or mount' : els ? 'attune' : 'mount';
  return { id: `pool:${ids.join('+')}`, icon: els ? 'bolt' : 'plus', text: `New: ${list} ${ids.length === 1 ? 'joins' : 'join'} your arsenal. Look for the New tag when you ${verb}.`,
    short: `New: ${list} (look for the New tag).` };
}

export const QM_COACH_ID = 'qm-on';
/** The Quartermaster's entry in the merged post-Prestige card (coach.ts postPrestigeDigest). */
export const QM_COACH_SHORT = 'Quartermaster: buys your stat upgrades, never your choices.';
export const QM_COACH_TEXT = 'Quartermaster: it banks a share of your new Scrap and buys your stat upgrades with it, never your choices.';
