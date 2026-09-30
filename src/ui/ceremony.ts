/**
 * First-Prestige ceremony (docs/ONBOARDING.md). The first Prestige is a story beat at the Frontier (wave ~28), not a
 * form: a short, warm modal says what you earn (the Forecast's exact Echoes), what resets and what stays (one sentence
 * each), where the Frontier moves, and has one primary button. Afterwards the Prestige tab opens on its Layer I picks
 * with a guide line ("Spend your Echoes…"); the affordable picks are highlighted (a class only). Nothing is ever
 * bought for the player. Second and later Prestiges use the full Prestige modal (prestige.ts), unchanged.
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

export const CEREMONY_TITLE = 'Your first Prestige';
export const CEREMONY_RESETS = 'Scrap, upgrades and the wave reset (this run\'s Cores and Anomalies too): you start again at wave 1.';
export const CEREMONY_KEEPS = 'You keep your Echoes, the Codex, your records and everything permanent.';
export const ECHO_GUIDE_TEXT = 'Spend your Echoes: these make every run stronger.';
/** Layer I opens at deepest-ever wave 20 (prestige-shop.ts LAYERS). */
const LAYER1_WAVE = 20;

type CeremonyState = Pick<UiState, 'meta' | 'forecast' | 'run'> & Partial<Pick<UiState, 'activeTrial'>>;

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
  const line = (ico: string, cls: string, text: string): HTMLElement => h('li', { class: `cer-line ${cls}` }, icon(ico, 'ico'), h('span', { text }));
  const body = h('div', { class: 'ceremony' },
    h('p', { class: 'cer-lead', text: `You pushed the machine to wave ${ui.run.deepestCleared}. Rebuild it stronger.` }),
    h('div', { class: 'cer-gain' }, icon('echo', 'ico big'), h('span', { class: 'cer-gain-val', text: fx.gain })),
    h('p', { class: 'cer-sub', text: 'Echoes buy upgrades that make every run stronger.' }),
    h('ul', { class: 'cer-lines' },
      line('restart', 'resets', fx.resets),
      line('check', 'keeps', fx.keeps),
      fx.frontier ? line('prestige', 'frontier', fx.frontier) : null));
  const go = button([icon('prestige'), fx.cta], () => {
    const frames = ui.meta.unlockedFrames.length ? ui.meta.unlockedFrames : ['standard' as const];
    const cmd: Extract<Command, { type: 'prestige' }> = { type: 'prestige', frame: frames.includes(ui.build.frame) ? ui.build.frame : frames[0] };
    ctx.host.send(cmd);
    ctx.host.saveNow();
    setPref('echoGuide', true);
    m.close();
    ctx.open('prestige_shop');
  }, { class: 'btn primary wide cer-go' });
  const m = openModal({ title: CEREMONY_TITLE, body, footer: go, className: 'ceremony-modal' });
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
  return { id: `pool:${ids.join('+')}`, icon: els ? 'bolt' : 'plus', text: `New: ${list} ${ids.length === 1 ? 'joins' : 'join'} your arsenal. Look for the New tag when you ${verb}.` };
}

export const QM_COACH_ID = 'qm-on';
export const QM_COACH_TEXT = 'Quartermaster: it buys your stat upgrades for you, never your choices.';
