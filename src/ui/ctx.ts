import type { UiState } from '@sim/core/types';
import type { UiHost } from './host';

export type ScreenId = 'forecast' | 'prestige' | 'prestige_shop' | 'constellation' | 'codex' | 'directives' | 'blueprints' | 'trials' | 'settings' | 'inspector' | 'menu' | 'abilities';
export type ToastKind = 'info' | 'good' | 'warn' | 'core' | 'codex';

/** Shared context handed to every UI component. */
export interface UiCtx {
  host: UiHost;
  state(): UiState | null;
  open(screen: ScreenId, arg?: unknown): void;
  toast(msg: string, kind?: ToastKind): void;
}
