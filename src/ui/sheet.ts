/**
 * Upgrades container: a bottom sheet with a drag handle and three snap heights (peek / half /
 * full) on narrow screens, a 360 px right side panel at ≥ 900 px. The peek height shows the
 * quick-buy chips (the compact combat panel) and the category tabs; the battlefield stays visible.
 */
import '../styles/sheet.css';
import { button, h } from './dom';
import { icon } from './icons';
import { arenaInsets, clampHeight, layoutMode, nextSnap, snapHeights, snapTarget, type LayoutMode, type SnapHeights, type SnapName } from './sheet-logic';
import { prefs, setPref } from './prefs';

export class Sheet {
  readonly el: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly reopen: HTMLButtonElement;
  mode: LayoutMode = 'sheet';
  snap: SnapName;
  panelOpen: boolean;
  heights: SnapHeights = { peek: 132, half: 400, full: 700 };
  onLayout: (() => void) | null = null;
  private height = 132;
  private hudHeight = 0;

  constructor(quick: HTMLElement, content: HTMLElement) {
    this.snap = prefs().sheetSnap;
    this.panelOpen = prefs().panelOpen;
    this.handle = button(h('span', { class: 'grab' }), () => { /* click handled by drag logic */ }, { class: 'sheet-handle', label: 'Resize the upgrades panel' });
    const collapse = button(icon('close'), () => this.setPanelOpen(false), { class: 'btn icon-btn ghost panel-close', label: 'Hide the upgrades panel (B)' });
    this.reopen = button([icon('shop'), 'Upgrades'], () => this.setPanelOpen(true), { class: 'btn panel-reopen' });
    this.el = h('aside', { class: 'sheet', attrs: { 'aria-label': 'Upgrades' } }, this.handle, collapse, h('div', { class: 'sheet-inner' }, quick, content));
    this.installDrag();
    this.handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); this.setSnap(this.snap === 'peek' ? 'half' : 'full'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.setSnap(this.snap === 'full' ? 'half' : 'peek'); }
    });
  }

  /** Recompute layout for the viewport (call on resize and when the HUD height changes). */
  layout(hudHeight: number): void {
    this.hudHeight = hudHeight;
    this.mode = layoutMode(window.innerWidth);
    this.el.classList.toggle('side', this.mode === 'side');
    this.el.classList.toggle('bottom', this.mode === 'sheet');
    document.body.classList.toggle('layout-side', this.mode === 'side');
    document.body.classList.toggle('layout-sheet', this.mode === 'sheet');
    this.heights = snapHeights(window.innerHeight, hudHeight);
    if (this.mode === 'sheet') this.applyHeight(this.heights[this.snap], false);
    else this.el.style.height = '';
    const hidden = this.mode === 'side' && !this.panelOpen;
    this.el.hidden = hidden;
    this.reopen.hidden = !hidden;
    document.body.classList.toggle('panel-closed', hidden);
  }

  insets(abilityBar: number): { top: number; right: number; bottom: number; left: number } {
    return arenaInsets(this.mode, this.snap, this.heights, this.hudHeight, abilityBar, this.panelOpen);
  }

  /** Current covered height at the bottom (sheet mode) for placing the ability bar. */
  get coveredBottom(): number { return this.mode === 'sheet' ? Math.min(this.height, this.heights.half) : 0; }

  setSnap(s: SnapName): void {
    this.snap = s;
    setPref('sheetSnap', s);
    if (this.mode === 'sheet') this.applyHeight(this.heights[s], true);
    this.handle.setAttribute('aria-expanded', s === 'peek' ? 'false' : 'true');
    this.onLayout?.();
  }

  toggle(): void {
    if (this.mode === 'side') this.setPanelOpen(!this.panelOpen);
    else this.setSnap(this.snap === 'peek' ? 'half' : 'peek');
  }

  setPanelOpen(on: boolean): void {
    this.panelOpen = on;
    setPref('panelOpen', on);
    this.layout(this.hudHeight);
    this.onLayout?.();
  }

  private applyHeight(px: number, animate: boolean): void {
    this.height = px;
    this.el.classList.toggle('animating', animate);
    this.el.style.height = `${Math.round(px)}px`;
    this.el.dataset.snap = this.snap;
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(Math.min(px, this.heights.half))}px`);
  }

  private installDrag(): void {
    let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false, pid = -1;
    const down = (e: PointerEvent): void => {
      if (this.mode !== 'sheet' || e.button !== 0) return;
      dragging = true; moved = false; pid = e.pointerId;
      startY = lastY = e.clientY; startH = this.height; lastT = performance.now(); vel = 0;
      try { this.handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const move = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pid) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vel = 0.7 * vel + 0.3 * ((lastY - e.clientY) / dt);
      lastY = e.clientY; lastT = now;
      this.applyHeight(clampHeight(startH - dy, this.heights), false);
    };
    const up = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      if (!moved) { this.setSnap(nextSnap(this.snap)); return; }
      this.setSnap(snapTarget(this.height, vel, this.heights));
    };
    this.handle.addEventListener('pointerdown', down);
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', up);
    this.handle.addEventListener('pointercancel', up);
    this.handle.addEventListener('click', (e) => { if ((e as MouseEvent).detail === 0) this.setSnap(nextSnap(this.snap)); });
  }
}
