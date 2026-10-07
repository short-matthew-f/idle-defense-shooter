/**
 * Spend counterfactual (Spend efficiency row). Damage share by srcTag misses what a tree's Scrap buys
 * when that tree scales or carries other systems' damage: Caliber (ballistics.damage) multiplies Poison,
 * Burn, Fusions and abilities, and every hardpoint hit can apply the attuned elements (credited to the
 * element). So a system flagged by shares is checked here: from the end-of-run save, the same waves at the
 * deepest cleared wave are fought with the full build and with that system's Scrap-bought ranks removed.
 * contribution = 1 − t_full / t_without (how much slower the build clears without the ranks).
 *
 * Harness only: it runs on copies of the final save after the climb, so it never changes the climb.
 */
import type { SaveState } from '../src/sim/core/types';
import { allNodes } from '../src/sim/core/content';
import { spendKey } from '../src/sim/economy/shop';
import { generateWave } from '../src/sim/enemies/generator';
import { runInjectedWave } from './difficulty';

/** Waves fought per build; enemy HP × HP_MUL so the fight is damage-limited rather than walk-in-limited. */
export const CF_WAVES = 6, CF_HP_MUL = 4, CF_MAX_SECONDS = 400;

export function spendContribution(save: SaveState, wave: number, systems: string[]): Record<string, number> {
  const waves = Array.from({ length: CF_WAVES }, (_, k) => {
    const d = generateWave(100 + k, Math.max(1, wave), 0, 0);
    for (const sp of d.spawns) sp.hpScale *= CF_HP_MUL;
    return d;
  });
  const time = (sv: SaveState): number => {
    let t = 0;
    for (const d of waves) t += runInjectedWave(sv, structuredClone(d), CF_MAX_SECONDS).seconds;
    return t;
  };
  const full = time(save);
  const out: Record<string, number> = {};
  for (const sys of systems) {
    const sv = structuredClone(save);
    let removed = 0;
    for (const info of allNodes()) {
      if (info.group === 'prestige' || info.group === 'star' || info.group === 'ability') continue;
      if (spendKey(info) === sys && sv.run.build.ranks[info.def.id]) { removed++; delete sv.run.build.ranks[info.def.id]; }
    }
    out[sys] = removed ? 1 - full / time(sv) : 0;
  }
  return out;
}
