/**
 * Read-only lookups over the content tables for names and descriptions (the UI never reads sim
 * internals; data tables are shared by design).
 */
import type { AbilityId, AnomalyId, BossId, ElementId, FrameId, HardpointId, NodeId, TreeId } from '@sim/core/ids';
import type { AbilityDef, AnomalyDef, FrameDef, NodeDef, TreeDef } from '@sim/data/schema';
import {
  ABILITIES, ANOMALIES, CHASSIS_LINKAGES, FRAMES, FUSIONS, INFUSIONS, PRESTIGE_NODES, STAR_NODES, TREES, TRIADS, WEAPON_LINKAGES, BOSSES, SECTORS,
} from '@sim/data/index';

export const TREE_BY_ID = new Map<TreeId, TreeDef>(TREES.map((t) => [t.id, t]));
export const ABILITY_BY_ID = new Map<AbilityId, AbilityDef>(ABILITIES.map((a) => [a.id, a]));
export const ANOMALY_BY_ID = new Map<AnomalyId, AnomalyDef>(ANOMALIES.map((a) => [a.id, a]));
export const FRAME_BY_ID = new Map<FrameId, FrameDef>(FRAMES.map((f) => [f.id, f]));
export const BOSS_BY_ID = new Map<BossId, (typeof BOSSES)[number]>(BOSSES.map((b) => [b.id, b]));

/** Every NodeDef by id (trees, doctrines, exotics, cross-system, prestige, stars, abilities). */
export const NODE_BY_ID = new Map<NodeId, NodeDef>();
for (const t of TREES) {
  for (const n of t.shared) NODE_BY_ID.set(n.id, n);
  for (const d of t.doctrines) for (const n of d.nodes) NODE_BY_ID.set(n.id, n);
  NODE_BY_ID.set(t.exotic.id, t.exotic);
}
for (const f of FUSIONS) NODE_BY_ID.set(f.node.id, f.node);
for (const f of TRIADS) NODE_BY_ID.set(f.node.id, f.node);
for (const l of WEAPON_LINKAGES) NODE_BY_ID.set(l.node.id, l.node);
for (const l of CHASSIS_LINKAGES) NODE_BY_ID.set(l.node.id, l.node);
for (const i of INFUSIONS) NODE_BY_ID.set(i.node.id, i.node);
for (const a of ABILITIES) NODE_BY_ID.set(a.rankNode.id, a.rankNode);
for (const p of PRESTIGE_NODES) NODE_BY_ID.set(p.id, p);
for (const s of STAR_NODES) NODE_BY_ID.set(s.id, s);

export function nodeName(id: NodeId): string { return NODE_BY_ID.get(id)?.name ?? id; }

export const CHASSIS: TreeId[] = ['ballistics', 'bastion', 'reactor'];
export const ELEMENTS: ElementId[] = ['fire', 'lightning', 'poison', 'frost'];
export const HARDPOINTS: HardpointId[] = ['ordnance', 'drones', 'blade', 'laser', 'gravitics'];

export const TREE_LABEL: Record<TreeId, string> = Object.fromEntries(TREES.map((t) => [t.id, t.name])) as Record<TreeId, string>;

/** Identity blurbs for the mount / attune pickers (design §6–§7). */
export const HARDPOINT_BLURB: Record<HardpointId, string> = {
  ordnance: 'Missiles, rockets and shells: burst damage that seeks, clusters and carpets the field.',
  drones: 'Autonomous gunships that hunt on their own and carry the tower\'s statuses outward.',
  blade: 'An orbital blade sweeping the ring around the tower: constant close-in cutting.',
  laser: 'Laser nodes join into a polygon of beams; enemies crossing the geometry burn.',
  gravitics: 'Gravity wells that pull formations together, crush, and set up everything else.',
};
export const ELEMENT_BLURB: Record<ElementId, string> = {
  fire: 'Burn stacks and spreading flames: damage over time that leaps between crowded enemies.',
  lightning: 'Shock and chain arcs: instant jumps through packed formations.',
  poison: 'Stacking toxins that grow deadlier the longer an enemy survives.',
  frost: 'Chill, freeze and shatter: control that turns slowed enemies brittle.',
};

export const ELEMENT_ICON: Record<ElementId, string> = { fire: 'bolt', lightning: 'bolt', poison: 'heart', frost: 'star' };

export function sectorName(id: string): string { return SECTORS.find((s) => s.id === id)?.name ?? id; }
export function sectorAccent(index: number): { fg: string; accent: string; bg: string } {
  const s = SECTORS[Math.max(0, Math.min(SECTORS.length - 1, index))];
  const c = (v: [number, number, number]): string => `rgb(${Math.round(v[0] * 255)} ${Math.round(v[1] * 255)} ${Math.round(v[2] * 255)})`;
  return { fg: c(s.palette.fg), accent: c(s.palette.accent), bg: c(s.palette.bg) };
}

/** Colour category for an event `src` tag (Inspector chips; always paired with the text). */
export function srcCategory(src: string): string {
  if (src.startsWith('fusion.') || src.startsWith('triad.')) return 'fusion';
  if (src.startsWith('link.') || src.startsWith('chassis.')) return 'link';
  if (src.startsWith('infuse.')) return 'infuse';
  if (src.startsWith('ability') ) return 'ability';
  if (src.startsWith('anomaly') ) return 'anomaly';
  const head = src.split(/[.:]/)[0];
  if ((ELEMENTS as string[]).includes(head)) return head;
  if ((HARDPOINTS as string[]).includes(head) || head === 'ballistics' || head === 'primary' || head === 'bastion' || head === 'reactor') return 'system';
  if (head === 'boss' || head === 'enemy') return 'enemy';
  return 'other';
}

export { ABILITIES, ANOMALIES, FRAMES, FUSIONS, TRIADS, WEAPON_LINKAGES, CHASSIS_LINKAGES, INFUSIONS, PRESTIGE_NODES, STAR_NODES, TREES, BOSSES, SECTORS };
