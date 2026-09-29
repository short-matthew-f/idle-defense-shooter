/**
 * Autocast (design §11, Prestige II `prestige.autocast`). WP9.
 *
 * Each slotted ability that no enabled Directive casts (when Directives are unlocked) fires whenever
 * it is affordable, off cooldown and has a sensible target, after the same reaction delay as
 * Directives (the "useful" condition must hold for `directives.reaction_delay` s first):
 *   hunter_mark        highest-threat enemy that is not already marked
 *   repulsor_pulse     an enemy inside the inner ring
 *   time_field, bombardment, missile_storm, singularity_bomb
 *                      the live boss, else the centroid of the densest group (ability radius)
 *   emp                an enemy within the EMP radius
 *   overdrive          an enemy within primary range
 *   emergency_repair   tower HP ≤ 70%
 *   drone_surge        any enemy
 * Casts are enqueued via World.enqueueCommand with `viaDirective: true, directive: -1`, so Counter
 * attempts earn `directives.counter_efficiency` (the boss system reads the flag).
 */
import type { World } from '../core/world';
import type { AbilityId } from '../core/ids';
import { INNER_RING, NO_ENTITY } from '../core/types';
import { abilityDef } from '../core/content';
import { ABILITY_IDS, abilityCost, abilityIndex, type AbilitiesSystem } from '../systems/abilities';
import { GroupFinder, findBoss, highestThreat } from './targeting-profiles';

const REPAIR_BELOW = 0.7;
const DEFAULT_GROUP_R = 100;

export class Autocast {
  private armedAt = new Int32Array(ABILITY_IDS.length).fill(-1);
  private pt = new Float32Array(3);   // x, y, target

  reset(): void { this.armedAt.fill(-1); }

  /**
   * Run one tick. `skip(id)` = the ability is owned by a Directive. `reservedCe` = CE already committed
   * by Directive casts enqueued this tick. Returns the CE committed by Autocast this tick.
   */
  update(w: World, abil: AbilitiesSystem, groups: GroupFinder, delayTicks: number, reservedCe: number, skip: (id: AbilityId) => boolean): number {
    const slots = w.build.abilities;
    let spent = 0;
    for (let k = 0; k < slots.length; k++) {
      const id = slots[k];
      if (!id) continue;
      const ai = abilityIndex(id);
      if (ai < 0) continue;
      if (skip(id) || !this.target(w, id, groups)) { this.armedAt[ai] = -1; continue; }
      if (this.armedAt[ai] < 0) this.armedAt[ai] = w.tick;
      if (w.tick - this.armedAt[ai] < delayTicks) continue;
      if (abil.castBlocker(w, id) !== null) continue;
      const cost = abilityCost(w, id);
      if (w.tower.ce - reservedCe - spent < cost - 1e-9) continue;
      spent += cost;
      this.armedAt[ai] = -1;
      const tg = this.pt[2] | 0;
      w.enqueueCommand({ type: 'cast', ability: id, x: this.pt[0], y: this.pt[1], ...(tg >= 0 ? { target: tg } : {}), viaDirective: true, directive: -1 });
    }
    return spent;
  }

  /** Sensible default target for `id` into this.pt (x, y, enemy); false when casting would be wasted. */
  private target(w: World, id: AbilityId, groups: GroupFinder): boolean {
    const pt = this.pt, e = w.enemies, s = w.stats;
    pt[0] = 0; pt[1] = 0; pt[2] = NO_ENTITY;
    switch (id) {
      case 'hunter_mark': {
        const b = findBoss(w);
        const i = b >= 0 && e.markedT[b] === 0 ? b : highestThreat(w);
        if (i < 0 || e.markedT[i] > 0) return false;
        pt[0] = e.x[i]; pt[1] = e.y[i]; pt[2] = i;
        return true;
      }
      case 'repulsor_pulse': return groups.countNear(w, 0, 0, INNER_RING) > 0;
      case 'emp': return groups.countNear(w, 0, 0, abilityDef('emp')?.radius ?? 220) > 0;
      case 'overdrive': return groups.countNear(w, 0, 0, s.get('ballistics.range')) > 0;
      case 'emergency_repair': return w.tower.hp > 0 && w.tower.hp <= w.tower.maxHp * REPAIR_BELOW;
      case 'drone_surge': return groups.countNear(w, 0, 0, 2000) > 0;
      case 'time_field': case 'bombardment': case 'missile_storm': case 'singularity_bomb': {
        const b = findBoss(w);
        if (b >= 0) { pt[0] = e.x[b]; pt[1] = e.y[b]; pt[2] = b; return true; }
        const r = id === 'bombardment' ? s.get('ability.bombardment.radius') : (abilityDef(id)?.radius || DEFAULT_GROUP_R);
        return groups.largest(w, r, pt) > 0;
      }
    }
    return false;
  }
}
