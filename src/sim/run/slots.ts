/**
 * Hardpoint and Attunement slot opening (design §4, §14 Prestige II).
 *  Hardpoints: waves 10/30/55/75, capped by the Frame (+1 Expanded Frame except Monolith; never
 *  more than 4 mounts including a Frame's free mount). Weapon Seed opens the first at wave 1;
 *  Early Hardpoints lowers the later ones by 5 per rank (floors 15/35/55).
 *  Attunements: waves 5/25/45, capped by the Frame (+1 Third Attunement). Elemental Memory opens
 *  the first at wave 1.
 * A threshold of 0 means "open from the start"; otherwise a slot opens when that wave is cleared.
 */
import type { WorldImpl } from '../core/world-impl';
import { frameDef } from '../core/content';
import { HARDPOINT_SLOT_WAVES, ATTUNEMENT_SLOT_WAVES } from '../economy/curves';

const HARDPOINT_FLOORS = [0, 15, 35, 55];

function prank(w: WorldImpl, id: string): number { return w.meta.prestigeRanks[id] | 0; }

export function hardpointCap(w: WorldImpl): number {
  const f = frameDef(w.build.frame);
  let cap = f.hardpointCap;
  if (prank(w, 'prestige.expanded_frame') > 0 && w.build.frame !== 'monolith') cap += 1;
  return Math.max(0, Math.min(cap, 4 - (f.freeMount ? 1 : 0)));
}
export function attunementCap(w: WorldImpl): number {
  return frameDef(w.build.frame).attunementCap + (prank(w, 'prestige.third_attunement') > 0 ? 1 : 0);
}

export function hardpointSlotWaves(w: WorldImpl): number[] {
  const early = prank(w, 'prestige.early_hardpoints');
  const out = HARDPOINT_SLOT_WAVES.map((t, i) => (i === 0 ? t : Math.max(HARDPOINT_FLOORS[i], t - 5 * early)));
  if (prank(w, 'prestige.weapon_seed') > 0) out[0] = 0;
  return out;
}
export function attunementSlotWaves(w: WorldImpl): number[] {
  const out = [...ATTUNEMENT_SLOT_WAVES] as number[];
  if (prank(w, 'prestige.elemental_memory') > 0) out[0] = 0;
  return out;
}

/** Recompute open slot counts from deepestCleared (never decreases) and pad the build arrays with nulls. */
export function updateSlots(w: WorldImpl): void {
  const d = w.run.deepestCleared;
  const hp = hardpointSlotWaves(w), at = attunementSlotWaves(w);
  let h = 0, a = 0;
  const hc = hardpointCap(w), ac = attunementCap(w);
  for (let i = 0; i < hp.length && i < hc; i++) if (hp[i] === 0 || d >= hp[i]) h++;
  for (let i = 0; i < at.length && i < ac; i++) if (at[i] === 0 || d >= at[i]) a++;
  w.run.hardpointSlotsOpen = Math.max(w.run.hardpointSlotsOpen, h);
  w.run.attunementSlotsOpen = Math.max(w.run.attunementSlotsOpen, a);
  while (w.build.hardpoints.length < w.run.hardpointSlotsOpen) w.build.hardpoints.push(null);
  while (w.build.attunements.length < w.run.attunementSlotsOpen) w.build.attunements.push(null);
}
