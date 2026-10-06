/**
 * Phase 3 presentation and accessibility (HANDBOOK-EVAL A-01, A-02, A-17, A-20): text size through the root `rem`,
 * the `reduce-motion` body class (mirrors every `prefers-reduced-motion` rule, src/styles/a11y.css), the left-hand
 * layout class and the arena canvas's label. Pure rules first, then the DOM appliers.
 */
import '../styles/a11y.css';
import type { UiState } from '@sim/core/types';
import { gfxSettings, onGfxChange, reducedMotion, systemReducedMotion, type MotionPref } from '@render/quality';
import { prefs } from './prefs';

export type TextScale = 100 | 115 | 130;
export const TEXT_SCALES: readonly TextScale[] = [100, 115, 130];

/** A stored text size, sanitised (anything unknown reads as 100). */
export function textScaleOf(raw: unknown): TextScale {
  return raw === 115 || raw === 130 ? raw : 100;
}

/** The root font size for a text scale ('' = the browser default, 16 px). */
export function rootFontSize(scale: TextScale): string {
  return scale === 100 ? '' : `${scale}%`;
}

/** Whether `body.reduce-motion` is on: the in-game setting (System follows the OS; Reduce forces it on; Full off). */
export function motionClassOn(pref: MotionPref, systemReduce: boolean): boolean {
  return reducedMotion(pref, systemReduce);
}

/** The arena canvas's accessible label (pure). Changes only with the wave, the boss state and a coarse HP step. */
export function arenaLabel(ui: Pick<UiState, 'run' | 'wave' | 'tower'>): string {
  const hp = ui.tower.maxHp > 0 ? Math.max(0, Math.round((ui.tower.hp / ui.tower.maxHp) * 100)) : 0;
  const boss = ui.wave.isBoss && ui.wave.bossMaxHp > 0
    ? ui.wave.bossHp > 0 ? `, boss fight, boss at ${Math.round((ui.wave.bossHp / ui.wave.bossMaxHp) * 100)}%` : ', boss defeated'
    : '';
  return `Battlefield: wave ${ui.run.wave}${boss}, tower health ${hp}%`;
}

/** Apply the text size now (Settings) and on boot. */
export function applyTextScale(scale: TextScale = textScaleOf(prefs().textScale)): void {
  const root = document.documentElement;
  root.style.fontSize = rootFontSize(scale);
  for (const s of TEXT_SCALES) document.body.classList.toggle(`text-${s}`, s === scale && s !== 100);
}

export function applyMotionClass(): void {
  document.body.classList.toggle('reduce-motion', motionClassOn(gfxSettings().motion, systemReducedMotion()));
}

export function applyLeftHand(on: boolean = prefs().leftHand): void {
  document.body.classList.toggle('left-hand', !!on);
}

let mounted = false;
/** Boot: apply the stored text size, motion class and hand; keep the motion class in step with the setting and the OS. */
export function mountA11y(): void {
  applyTextScale();
  applyMotionClass();
  applyLeftHand();
  if (mounted) return;
  mounted = true;
  onGfxChange(() => applyMotionClass());
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyMotionClass); } catch { /* old browsers */ }
}

/** The arena canvas: `role="img"` with a label refreshed at most when the wave or the boss state changes. */
export class ArenaLabel {
  private key = '';
  constructor(private readonly canvas: HTMLElement | null = document.getElementById('game')) {
    this.canvas?.setAttribute('role', 'img');
    this.canvas?.setAttribute('aria-label', 'Battlefield');
  }
  update(ui: UiState): void {
    const bossOn = ui.wave.isBoss && ui.wave.bossMaxHp > 0;
    const key = `${ui.run.wave}|${bossOn}|${bossOn && ui.wave.bossHp <= 0}`;
    if (key === this.key || !this.canvas) return;
    this.key = key;
    this.canvas.setAttribute('aria-label', arenaLabel(ui));
  }
}
