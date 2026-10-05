/**
 * Reveal gates the sim shares with the UI's unlock ladder (src/ui/progression.ts), so offers (boons, Anomaly
 * drafts, their rerolls) never name a system the player has not been shown yet (docs/BOONS.md "Ladder").
 *
 * THE content pool: Prestiges needed before an element / weapon system is OFFERED (slot pickers, Refit, Blueprints,
 * Directive system pickers, boon and Anomaly offers; Fusions / Linkages / Infusions follow their parts, see
 * ui/progression.ts poolAllows). The sim accepts any attune / mount command. One new system per early Prestige,
 * each a "New" moment (docs/ONBOARDING.md):
 *
 *   P0  fire, lightning, poison · ordnance, drones   the starters: 3 elements for 2 attunement slots (waves 5, 25), 2 weapons
 *   P1  + frost                                       Superconductivity, Thermal Shock, Cryotoxin become possible
 *   P2  + blade (Orbital Blade)                       the second hardpoint slot (wave 30, reached from P1 on) becomes a choice
 *   P3  + laser (Laser Polygon)                       in time for the third hardpoint slot (wave 55; P3 reaches ~61)
 *   P4  + gravitics                                   everything offered
 *
 * Anything owned (attuned, mounted, run by the Frame or borrowed) is always offered, whatever the Prestige count.
 */
import type { ElementId, HardpointId } from '../core/ids';

export const CONTENT_POOL: { readonly elements: Readonly<Record<ElementId, number>>; readonly hardpoints: Readonly<Record<HardpointId, number>> } = {
  elements: { fire: 0, lightning: 0, poison: 0, frost: 1 },
  hardpoints: { ordnance: 0, drones: 0, blade: 2, laser: 3, gravitics: 4 },
};
export const STARTER_ELEMENTS: readonly ElementId[] = ['fire', 'lightning', 'poison'];
export const STARTER_HARDPOINTS: readonly HardpointId[] = ['ordnance', 'drones'];
/** The Prestige count at which every id is offered. */
export const POOL_COMPLETE_AT = Math.max(...Object.values(CONTENT_POOL.elements), ...Object.values(CONTENT_POOL.hardpoints));

/** Prestiges before `id` (an element or hardpoint) is in the pool; 0 for anything else. */
export function poolPrestige(id: string): number {
  return (CONTENT_POOL.elements as Record<string, number>)[id] ?? (CONTENT_POOL.hardpoints as Record<string, number>)[id] ?? 0;
}

/**
 * Best wave cleared that reveals tactical abilities and Command Energy (the ladder's `abilities` rung,
 * ui/progression.ts UNLOCKS.abilities; tests/ui/progression.test.ts asserts they agree). A first Prestige reveals them too.
 */
export const ABILITIES_REVEAL_WAVE = 12;
export const ABILITIES_REVEAL_PRESTIGE = 1;

/** Are abilities / CE revealed at this progress (best wave cleared, Prestige count)? */
export function abilitiesRevealed(bestWave: number, prestigeCount: number): boolean {
  return bestWave >= ABILITIES_REVEAL_WAVE || prestigeCount >= ABILITIES_REVEAL_PRESTIGE;
}

/**
 * UX Phase 2 item 7: best wave cleared that reveals Doctrines (the ladder's `doctrines` rung, ui/progression.ts, with a
 * coach line). The sim opens forks as before (shop forkRequirement); the UI hides fork cards/rows until this is reached.
 * Any deepest-ever wave counts, so a Prestiged player keeps them revealed.
 */
export const DOCTRINES_REVEAL_WAVE = 10;

/** Are Doctrine forks revealed at this best wave cleared (max of this run's and the lifetime deepest)? */
export function doctrinesRevealed(bestWave: number): boolean { return bestWave >= DOCTRINES_REVEAL_WAVE; }
