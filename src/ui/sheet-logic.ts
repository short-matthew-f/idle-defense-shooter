/**
 * Pure layout math for the upgrades sheet: bottom sheet (three snap heights) on narrow screens,
 * a 360 px side panel at ≥ 900 px.
 */
export type SnapName = 'peek' | 'half' | 'full';
export type LayoutMode = 'sheet' | 'side';
export interface SnapHeights { peek: number; half: number; full: number }

export const SIDE_BREAKPOINT = 900;
export const SIDE_PANEL_WIDTH = 360;
export const PEEK_HEIGHT = 132;
export const SNAP_ORDER: readonly SnapName[] = ['peek', 'half', 'full'];

export function layoutMode(viewWidth: number): LayoutMode { return viewWidth >= SIDE_BREAKPOINT ? 'side' : 'sheet'; }

/** Snap heights (px from the bottom) for a viewport; `topReserved` keeps the HUD visible at full. */
export function snapHeights(viewHeight: number, topReserved: number, peek = PEEK_HEIGHT): SnapHeights {
  const full = Math.max(peek + 40, Math.round(viewHeight - topReserved - 8));
  const half = Math.min(full - 20, Math.max(peek + 20, Math.round(viewHeight * 0.5)));
  return { peek, half, full };
}

export function clampHeight(h: number, s: SnapHeights): number { return h < s.peek ? s.peek : h > s.full ? s.full : h; }

/**
 * Where a released drag lands. `velocity` is px/ms, positive = the sheet growing (finger moving up).
 * A flick (|v| ≥ 0.4) moves one snap in its direction from the nearest-below/above snap; otherwise
 * the nearest snap wins.
 */
export function snapTarget(h: number, velocity: number, s: SnapHeights, flick = 0.4): SnapName {
  if (Math.abs(velocity) >= flick) {
    if (velocity > 0) { for (const n of SNAP_ORDER) if (s[n] > h + 1) return n; return 'full'; }
    for (let i = SNAP_ORDER.length - 1; i >= 0; i--) if (s[SNAP_ORDER[i]] < h - 1) return SNAP_ORDER[i];
    return 'peek';
  }
  let best: SnapName = 'peek', d = Infinity;
  for (const n of SNAP_ORDER) { const dd = Math.abs(s[n] - h); if (dd < d) { d = dd; best = n; } }
  return best;
}

/** Tapping the handle: peek → half, half → full, full → peek. */
export function nextSnap(cur: SnapName): SnapName { return cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'peek'; }

/**
 * Camera insets that keep the arena clear of the UI. At 'full' the sheet is an overlay, so the
 * arena keeps the 'half' inset instead of shrinking to nothing.
 */
export function arenaInsets(mode: LayoutMode, snap: SnapName, s: SnapHeights, hudHeight: number, abilityBar: number, panelOpen = true):
  { top: number; right: number; bottom: number; left: number } {
  if (mode === 'side') return { top: hudHeight, right: panelOpen ? SIDE_PANEL_WIDTH : 0, bottom: abilityBar, left: 0 };
  // Expanded (half / full): the arena shrinks to the space above the half sheet and the ability
  // bar floats over its lower edge, so the whole arena stays visible without collapsing to a dot.
  const bottom = snap === 'peek' ? s.peek + abilityBar : s.half;
  return { top: hudHeight, right: 0, bottom, left: 0 };
}
