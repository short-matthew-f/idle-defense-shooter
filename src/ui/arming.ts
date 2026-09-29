/**
 * Ability arming state machine (pure). Tap a slot to arm a targeted ability, then tap the field
 * to cast it there; self-target abilities cast at the tower immediately.
 *
 *   idle ──press(ready, point|enemy)──▶ armed(slot) ──tapField──▶ idle (+cast)
 *    ▲                                   │ press same slot / cancel / slot emptied
 *    └───────────────────────────────────┘
 * While idle, tapping the field designates the nearest enemy (if any).
 */
import type { AbilityId } from '@sim/core/ids';
import type { Command } from '@sim/core/types';

export type Targeting = 'point' | 'enemy' | 'self';
export interface SlotInfo { ability: AbilityId | null; ready: boolean; targeted: Targeting }

export type ArmResult =
  | { kind: 'none'; reason?: 'empty' | 'not_ready' }
  | { kind: 'armed'; slot: number; ability: AbilityId }
  | { kind: 'disarmed' }
  | { kind: 'command'; cmd: Command };

export class AbilityArming {
  slot = -1;
  ability: AbilityId | null = null;

  get armed(): boolean { return this.slot >= 0; }

  /** Tap (or key 1–4) on an ability slot. */
  press(slot: number, info: SlotInfo): ArmResult {
    if (!info.ability) { this.cancel(); return { kind: 'none', reason: 'empty' }; }
    if (this.slot === slot) { this.cancel(); return { kind: 'disarmed' }; }
    if (!info.ready) return { kind: 'none', reason: 'not_ready' };
    if (info.targeted === 'self') {
      this.cancel();
      return { kind: 'command', cmd: { type: 'cast', ability: info.ability, x: 0, y: 0 } };
    }
    this.slot = slot; this.ability = info.ability;
    return { kind: 'armed', slot, ability: info.ability };
  }

  /**
   * Tap on the battlefield at world (x, y); `enemy` is the nearest enemy pool index within reach
   * (or null). Armed: cast there (targeting that enemy if any). Idle: designate the enemy.
   */
  tapField(x: number, y: number, enemy: number | null): ArmResult {
    if (this.armed && this.ability) {
      const ability = this.ability;
      this.cancel();
      const cmd: Command = enemy !== null ? { type: 'cast', ability, x, y, target: enemy } : { type: 'cast', ability, x, y };
      return { kind: 'command', cmd };
    }
    if (enemy !== null) return { kind: 'command', cmd: { type: 'designate', enemy } };
    return { kind: 'none' };
  }

  /** Slots changed (picker, Prestige): disarm if the armed ability left its slot. */
  sync(slots: readonly (AbilityId | null)[]): boolean {
    if (this.armed && slots[this.slot] !== this.ability) { this.cancel(); return true; }
    return false;
  }

  cancel(): void { this.slot = -1; this.ability = null; }
}
