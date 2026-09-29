/**
 * WP-DATA content validation: ids, references, pricing, counts against design v2.
 */
import { describe, expect, it } from 'vitest';
import {
  TREES, FRAMES, FUSIONS, TRIADS, WEAPON_LINKAGES, CHASSIS_LINKAGES, INFUSIONS, ANOMALIES, ABILITIES,
  TRIALS, PRESTIGE_NODES, STAR_NODES, SYSTEM_ORDER_IDS, ELEMENT_ORDER, BASE_STATS,
} from '../../src/sim/data/index';
import type { NodeDef, StatEffect, TreeDef } from '../../src/sim/data/schema';

type Owned = { node: NodeDef; prefix: string; scrap: boolean; tree?: TreeDef };

function treeNodes(t: TreeDef): NodeDef[] {
  return [...t.shared, ...t.doctrines.flatMap((d) => d.nodes), t.exotic];
}

/** Every purchasable node with the id prefix its table requires. */
function ownedNodes(): Owned[] {
  const out: Owned[] = [];
  for (const t of TREES) {
    for (const n of treeNodes(t)) out.push({ node: n, prefix: n.ability ? 'ability.' : `${t.id}.`, scrap: true, tree: t });
  }
  for (const f of FUSIONS) out.push({ node: f.node, prefix: 'fusion.', scrap: true });
  for (const f of TRIADS) out.push({ node: f.node, prefix: 'triad.', scrap: true });
  for (const l of WEAPON_LINKAGES) out.push({ node: l.node, prefix: 'link.', scrap: true });
  for (const l of CHASSIS_LINKAGES) out.push({ node: l.node, prefix: 'chassis.', scrap: true });
  for (const i of INFUSIONS) out.push({ node: i.node, prefix: 'infuse.', scrap: true });
  for (const p of PRESTIGE_NODES) out.push({ node: p, prefix: 'prestige.', scrap: false });
  for (const s of STAR_NODES) out.push({ node: s, prefix: 'star.', scrap: false });
  return out;
}

const ALL = ownedNodes();
const ALL_IDS = new Set(ALL.map((o) => o.node.id));

const EXPECTED_DOCTRINES: Record<string, string[]> = {
  ballistics: ['multishot', 'piercing', 'ricochet', 'heavy_rounds'],
  bastion: ['fortress', 'aegis', 'thorns', 'phoenix'],
  reactor: ['overclock', 'salvage', 'synchronization', 'command'],
  fire: ['wildfire', 'inferno'],
  lightning: ['chain', 'storm'],
  poison: ['plague', 'venom'],
  frost: ['control', 'shatter'],
  ordnance: ['hunter', 'swarm', 'bombard'],
  drones: ['wing', 'arc', 'carrier', 'support'],
  blade: ['twinning', 'greatblade', 'tempest'],
  laser: ['expansion', 'resonance', 'containment'],
  gravitics: ['collapse', 'lensing', 'tidal'],
};

describe('content ids', () => {
  it('every node id is unique across all tables', () => {
    const seen = new Map<string, number>();
    for (const o of ALL) seen.set(o.node.id, (seen.get(o.node.id) ?? 0) + 1);
    const dups = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dups).toEqual([]);
  });

  it('every node id starts with its tree / category prefix', () => {
    const bad = ALL.filter((o) => !o.node.id.startsWith(o.prefix) || o.node.id.length <= o.prefix.length).map((o) => o.node.id);
    expect(bad).toEqual([]);
  });

  it('ability rank nodes live in the Reactor tree and are the same objects as ABILITIES[].rankNode', () => {
    const reactor = TREES.find((t) => t.id === 'reactor')!;
    for (const a of ABILITIES) {
      expect(a.rankNode.id).toBe(`ability.${a.id}`);
      expect(a.rankNode.ability).toBe(a.id);
      expect(a.rankNode.maxRank).toBe(3);
      expect(reactor.shared).toContain(a.rankNode);
    }
  });

  it('every requires / capstone / doctrine reference resolves', () => {
    for (const o of ALL) for (const r of o.node.requires ?? []) expect(ALL_IDS.has(r), `${o.node.id} requires ${r}`).toBe(true);
    for (const t of TREES) {
      for (const d of t.doctrines) {
        const cap = d.nodes.find((n) => n.id === d.capstone);
        expect(cap, `${t.id}/${d.id} capstone ${d.capstone}`).toBeDefined();
        expect(cap!.tier).toBe(3);
        expect(cap!.kind).toBe('mechanic');
        for (const n of d.nodes) expect(n.doctrine, n.id).toBe(d.id);
      }
      for (const n of t.shared) expect(n.doctrine, n.id).toBeUndefined();
      expect(t.exotic.doctrine).toBeUndefined();
    }
  });

  it('every doctrine belongs to its tree and matches the design', () => {
    expect(TREES.map((t) => t.id).sort()).toEqual(Object.keys(EXPECTED_DOCTRINES).sort());
    for (const t of TREES) {
      expect(t.doctrines.map((d) => d.id), t.id).toEqual(EXPECTED_DOCTRINES[t.id]);
      for (const d of t.doctrines) expect(d.tree).toBe(t.id);
      expect(t.exotic.kind).toBe('exotic');
      expect(t.exotic.cost).toEqual({ cores: 2 });
      expect(t.forkRequirement).toBeGreaterThan(0);
      expect(t.forkRequirement).toBeLessThanOrEqual(t.shared.length);
      const cat = ['ballistics', 'bastion', 'reactor'].includes(t.id) ? 'chassis' : (ELEMENT_ORDER as readonly string[]).includes(t.id) ? 'element' : 'hardpoint';
      expect(t.category).toBe(cat);
    }
  });

  it('design-named node ids exist', () => {
    const required = [
      'ballistics.execution', 'ballistics.gunstorm', 'ballistics.multishot.split_sight', 'ballistics.piercing.last_rites',
      'ballistics.ricochet.return_fire', 'ballistics.heavy.staggerhead',
      'bastion.second_core', 'bastion.fortress.keep', 'bastion.aegis.mirror_aegis', 'bastion.thorns.spite', 'bastion.phoenix.ember_heart',
      'reactor.targeting_logic', 'reactor.critical_mass', 'reactor.overclock.overdrive_core', 'reactor.salvage.strip_mine',
      'reactor.sync.harmonic_lock', 'reactor.command.fourth_slot',
      'fire.meteor_round', 'lightning.supercell', 'poison.pandemic', 'frost.absolute_zero',
      'fire.wildfire.flashpoint', 'fire.wildfire.spread', 'fire.inferno.fireball_every', 'fire.inferno.crits_ignite',
      'lightning.chain.forked_current', 'lightning.chain.static_charge', 'lightning.chain.discharge',
      'lightning.storm.ball_lightning', 'lightning.storm.arc_anchor',
      'poison.plague.contagion', 'poison.plague.plague_carrier', 'poison.venom.virulence', 'poison.venom.corrosion', 'poison.venom.toxic_burst',
      'frost.control.deep_freeze', 'frost.control.permafrost', 'frost.control.glacial_shot', 'frost.shatter.brittle', 'frost.shatter.iceburst',
      'ordnance.launchers', 'ordnance.tracking', 'ordnance.reload', 'ordnance.range', 'ordnance.blast_radius', 'ordnance.overkill_guidance',
      'ordnance.cluster_warheads', 'ordnance.hunter.priority', 'ordnance.hunter.siegebreaker', 'ordnance.hunter.kill_order',
      'ordnance.swarm.rockets', 'ordnance.swarm.afterburner', 'ordnance.swarm.cascade', 'ordnance.bombard.bomb_bay', 'ordnance.bombard.carpet',
      'drones.count', 'drones.orbit_radius', 'drones.speed', 'drones.attack_speed', 'drones.targeting', 'drones.payload',
      'drones.wing.sortie', 'drones.arc.faraday_web', 'drones.carrier.brood', 'drones.support.aegis_wing',
      'blade.damage', 'blade.length', 'blade.rotation_speed', 'blade.knockback', 'blade.serration', 'blade.deflection',
      'blade.twinning.gyre', 'blade.greatblade.sunder', 'blade.tempest.cyclone',
      'laser.nodes', 'laser.radius', 'laser.rotation', 'laser.beam_width', 'laser.damage', 'laser.node_durability', 'laser.pulse',
      'laser.vertex_blast', 'laser.expansion.mandala', 'laser.resonance.standing_wave', 'laser.containment.crush',
      'gravitics.wells', 'gravitics.pull', 'gravitics.radius', 'gravitics.duration', 'gravitics.cooldown', 'gravitics.mass_driver',
      'gravitics.collapse.chain_collapse', 'gravitics.lensing.focal_point', 'gravitics.tidal.orbit_lock',
    ];
    expect(required.filter((id) => !ALL_IDS.has(id))).toEqual([]);
  });
});

describe('stats', () => {
  const effectSources: { owner: string; effects: StatEffect[] }[] = [
    ...ALL.map((o) => ({ owner: o.node.id, effects: o.node.effects })),
    ...FRAMES.map((f) => ({ owner: `frame.${f.id}`, effects: f.effects })),
    ...ANOMALIES.map((a) => ({ owner: `anomaly.${a.id}`, effects: a.effects })),
  ];

  it('every StatKey referenced by an effect has a BASE_STATS entry', () => {
    const missing = new Set<string>();
    for (const s of effectSources) for (const e of s.effects) if (!(e.stat in BASE_STATS)) missing.add(`${e.stat} (from ${s.owner})`);
    expect([...missing]).toEqual([]);
  });

  it('BASE_STATS contains the core-required keys with the agreed bases', () => {
    const required: Record<string, number> = {
      'ballistics.damage': 10, 'ballistics.attack_speed': 2, 'ballistics.range': 300, 'ballistics.projectile_speed': 420,
      'ballistics.crit_chance': 0.05, 'ballistics.crit_damage': 1.5, 'ballistics.target_acquisition': 0,
      'ballistics.multishot.count': 1, 'ballistics.multishot.penalty': 0.35, 'ballistics.piercing.count': 0,
      'ballistics.piercing.retention': 0.5, 'ballistics.piercing.velocity': 0, 'ballistics.ricochet.bounces': 0,
      'ballistics.ricochet.range': 120, 'ballistics.heavy.size': 1, 'ballistics.heavy.knockback': 0, 'ballistics.heavy.damage': 1,
      'bastion.max_hp': 100, 'bastion.armor': 0, 'bastion.shield_capacity': 0, 'bastion.shield_recharge': 0,
      'bastion.regeneration': 0, 'bastion.resistance': 0, 'reactor.global_attack_speed': 1, 'reactor.cooldown_reduction': 0,
      'reactor.energy_recycling': 0, 'economy.scrap_mul': 1, 'economy.ce_cap': 100, 'economy.core_drop_chance': 0.02,
      'fire.burn_chance': 0.15, 'lightning.arc_targets': 2, 'ordnance.launchers': 1, 'drones.count': 1, 'blade.length': 60,
      'laser.nodes': 2, 'gravitics.wells': 1,
    };
    for (const [k, v] of Object.entries(required)) expect(BASE_STATS[k], k).toBe(v);
    for (const v of Object.values(BASE_STATS)) expect(Number.isFinite(v)).toBe(true);
  });

  it('a stat node\'s StatKey equals its node id (Scrap tables)', () => {
    const bad = ALL.filter((o) => o.scrap && o.node.kind === 'stat' && o.node.effects[0]?.stat !== o.node.id).map((o) => o.node.id);
    expect(bad).toEqual([]);
  });

  it('lightning arcs 2 → 5 targets', () => {
    const n = ALL.find((o) => o.node.id === 'lightning.arc_targets')!.node;
    expect(BASE_STATS['lightning.arc_targets'] + n.maxRank * n.effects[0].perRank).toBe(5);
  });
});

describe('pricing', () => {
  it('costs are positive and well-formed', () => {
    for (const { node: n } of ALL) {
      expect(n.maxRank, n.id).toBeGreaterThanOrEqual(1);
      expect(n.desc.length, n.id).toBeGreaterThan(10);
      expect(n.desc).not.toMatch(/TODO|TBD|lorem|placeholder/i);
      const c = n.cost;
      if ('base' in c) { expect(c.base, n.id).toBeGreaterThan(0); expect(c.growth, n.id).toBeGreaterThan(1); }
      else if ('flat' in c) {
        expect(c.flat.length, n.id).toBe(n.maxRank);
        for (let i = 0; i < c.flat.length; i++) {
          expect(c.flat[i], n.id).toBeGreaterThan(0);
          if (i > 0) expect(c.flat[i], n.id).toBeGreaterThanOrEqual(c.flat[i - 1]);
        }
      } else { expect(c.cores, n.id).toBe(2); expect(n.kind).toBe('exotic'); }
    }
  });

  it('Scrap stat growth is within [1.15, 1.22]', () => {
    for (const o of ALL) {
      if (!o.scrap || !('base' in o.node.cost)) continue;
      expect(o.node.cost.growth, o.node.id).toBeGreaterThanOrEqual(1.15);
      expect(o.node.cost.growth, o.node.id).toBeLessThanOrEqual(1.22);
    }
  });

  it('Prestige nodes cost Echoes rising ×1.5 per rank', () => {
    for (const p of PRESTIGE_NODES) expect(p.cost).toMatchObject({ growth: 1.5 });
  });

  it('mechanic flat costs rise ≈×8 per tier within each tree', () => {
    for (const t of TREES) {
      const firstByTier = new Map<number, number[]>();
      for (const n of treeNodes(t)) {
        if (n.kind !== 'mechanic' || !('flat' in n.cost)) continue;
        const arr = firstByTier.get(n.tier) ?? [];
        arr.push(n.cost.flat[0]);
        firstByTier.set(n.tier, arr);
      }
      const tiers = [...firstByTier.keys()].sort((a, b) => a - b);
      // every mechanic in a tier shares the same first-rank price
      for (const tier of tiers) expect(new Set(firstByTier.get(tier)).size, `${t.id} tier ${tier}`).toBe(1);
      for (let i = 1; i < tiers.length; i++) {
        const lo = firstByTier.get(tiers[i - 1])![0], hi = firstByTier.get(tiers[i])![0];
        const ratio = (hi / lo) ** (1 / (tiers[i] - tiers[i - 1]));
        expect(ratio, `${t.id} tier ${tiers[i - 1]}→${tiers[i]}`).toBeGreaterThanOrEqual(6);
        expect(ratio, `${t.id} tier ${tiers[i - 1]}→${tiers[i]}`).toBeLessThanOrEqual(10);
      }
    }
  });

  it('hardpoint trees start pricier than chassis trees', () => {
    const firstStat = (id: string) => {
      const t = TREES.find((x) => x.id === id)!;
      return Math.min(...t.shared.filter((n) => 'base' in n.cost).map((n) => (n.cost as { base: number }).base));
    };
    const doctrineMech = (id: string) => {
      const t = TREES.find((x) => x.id === id)!;
      const n = t.doctrines.flatMap((d) => d.nodes).find((x) => x.kind === 'mechanic' && x.tier === 2)!;
      return (n.cost as { flat: number[] }).flat[0];
    };
    for (const hp of ['ordnance', 'drones', 'blade', 'laser', 'gravitics']) {
      expect(firstStat(hp)).toBeGreaterThanOrEqual(firstStat('ballistics'));
      expect(doctrineMech(hp)).toBeGreaterThan(doctrineMech('ballistics'));
    }
  });
});

describe('cross-system tables', () => {
  it('fusions cover each element pair once and are attunable', () => {
    const pairs = new Set<string>();
    for (const f of FUSIONS) {
      const [a, b] = f.elements;
      expect(ELEMENT_ORDER).toContain(a); expect(ELEMENT_ORDER).toContain(b);
      expect(a).not.toBe(b);
      pairs.add([a, b].sort().join('+'));
      expect(f.node.id).toBe(`fusion.${f.id}`);
      expect(f.node.maxRank).toBe(3);
    }
    expect(pairs.size).toBe(6);
  });

  it('triads cover each element triple once and are attunable', () => {
    const triples = new Set<string>();
    for (const t of TRIADS) {
      expect(new Set(t.elements).size).toBe(3);
      for (const e of t.elements) expect(ELEMENT_ORDER).toContain(e);
      triples.add([...t.elements].sort().join('+'));
      expect(t.node.id).toBe(`triad.${t.id}`);
      expect(t.node.maxRank).toBe(3);
    }
    expect(triples.size).toBe(4);
  });

  it('weapon linkage ids follow SYSTEM_ORDER_IDS and cover all 15 pairs', () => {
    const order = SYSTEM_ORDER_IDS as readonly string[];
    const seen = new Set<string>();
    for (const l of WEAPON_LINKAGES) {
      const [a, b] = l.pair;
      expect(order.indexOf(a), l.id).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(a), l.id).toBeLessThan(order.indexOf(b));
      expect(l.id).toBe(`link.${a}+${b}`);
      expect(l.node.id).toBe(l.id);
      expect(l.node.maxRank).toBe(3);
      seen.add(l.id);
    }
    expect(seen.size).toBe(15);
  });

  it('chassis linkages pair Bastion and Reactor with every hardpoint', () => {
    const seen = new Set<string>();
    for (const l of CHASSIS_LINKAGES) {
      const [c, hp] = l.pair;
      expect(['bastion', 'reactor']).toContain(c);
      expect(['ordnance', 'drones', 'blade', 'laser', 'gravitics']).toContain(hp);
      expect(l.id).toBe(`chassis.${c}+${hp}`);
      expect(l.node.id).toBe(l.id);
      expect(l.node.maxRank).toBe(3);
      seen.add(l.id);
    }
    expect(seen.size).toBe(10);
  });

  it('infusions cover every hardpoint × element', () => {
    const seen = new Set<string>();
    for (const i of INFUSIONS) {
      expect(i.id).toBe(`infuse.${i.system}.${i.element}`);
      expect(i.node.id).toBe(i.id);
      expect(i.node.maxRank).toBe(3);
      seen.add(i.id);
    }
    expect(seen.size).toBe(20);
  });
});

describe('design counts and tables', () => {
  it('matches the design counts', () => {
    expect(WEAPON_LINKAGES.length).toBe(15);
    expect(CHASSIS_LINKAGES.length).toBe(10);
    expect(INFUSIONS.length).toBe(20);
    expect(FUSIONS.length).toBe(6);
    expect(TRIADS.length).toBe(4);
    expect(ABILITIES.length).toBe(10);
    expect(FRAMES.length).toBe(9);
    expect(TRIALS.length).toBe(10);
    expect(ANOMALIES.length).toBeGreaterThanOrEqual(19);
    expect(ANOMALIES.filter((a) => a.pool === 'base').length).toBe(19);
    expect(TREES.length).toBe(12);
  });

  it('abilities carry the design CE costs and short cooldowns', () => {
    const costs: Record<string, number> = {
      hunter_mark: 25, repulsor_pulse: 30, time_field: 35, bombardment: 40, emp: 40,
      overdrive: 45, emergency_repair: 50, drone_surge: 50, missile_storm: 60, singularity_bomb: 70,
    };
    for (const a of ABILITIES) {
      expect(a.cost, a.id).toBe(costs[a.id]);
      expect(a.cooldown).toBeGreaterThanOrEqual(4);
      expect(a.cooldown).toBeLessThanOrEqual(12);
    }
    expect(new Set(ABILITIES.map((a) => a.id)).size).toBe(10);
  });

  it('frames match the design caps', () => {
    const caps: Record<string, [number, number]> = {
      standard: [3, 2], arsenal: [4, 1], conductor: [2, 3], monolith: [1, 2], hive: [2, 2],
      bulwark: [3, 2], echo_engine: [3, 2], prism: [3, 2], singularity_core: [4, 4],
    };
    for (const f of FRAMES) {
      expect([f.hardpointCap, f.attunementCap], f.id).toEqual(caps[f.id]);
      expect(f.hardpointCap + (f.freeMount ? 1 : 0)).toBeLessThanOrEqual(4);
    }
    expect(FRAMES.find((f) => f.id === 'hive')!.freeMount).toBe('drones');
    expect(FRAMES.find((f) => f.id === 'prism')!.freeMount).toBe('laser');
    expect(FRAMES.find((f) => f.id === 'arsenal')!.effects).toContainEqual({ stat: 'ballistics.damage', op: 'mul', perRank: -0.25 });
  });

  it('anomalies have unique ids and valid needs', () => {
    expect(new Set(ANOMALIES.map((a) => a.id)).size).toBe(ANOMALIES.length);
    const valid = ['primary', 'ordnance', 'drones', 'blade', 'laser', 'gravitics', ...ELEMENT_ORDER];
    for (const a of ANOMALIES) for (const n of a.needs ?? []) expect(valid).toContain(n);
    for (const pool of ['echo', 'rot']) expect(ANOMALIES.filter((a) => a.pool === pool).length).toBeGreaterThanOrEqual(3);
  });

  it('trials use tiers 30 / 60 / 90', () => {
    for (const t of TRIALS) expect(t.tiers).toEqual([30, 60, 90]);
    expect(new Set(TRIALS.map((t) => t.id)).size).toBe(10);
  });

  it('prestige layers are populated with the design names', () => {
    for (const layer of [1, 2, 3, 4]) expect(PRESTIGE_NODES.filter((p) => p.layer === layer).length).toBeGreaterThan(0);
    const names = new Set(PRESTIGE_NODES.map((p) => p.name));
    for (const n of ['Seed Capital', 'Memory of Steel', 'Memory of Motion', 'Accelerated Clearing', 'Keepsake', 'Directives',
      'Long Patrol', 'Expanded Frame', 'Dual Doctrine', 'Paradox Pool', 'Autonomy']) expect(names.has(n), n).toBe(true);
  });

  it('constellation region 0 has 6 majors, bridges between majors, and minors', () => {
    const r0 = STAR_NODES.filter((s) => s.region === 0);
    const majors = r0.filter((s) => s.kind2 === 'major');
    expect(majors.map((m) => m.id).sort()).toEqual(SYSTEM_ORDER_IDS.map((s) => `star.major.${s}`).sort());
    const bridges = r0.filter((s) => s.kind2 === 'bridge');
    expect(bridges.length).toBeGreaterThanOrEqual(3);
    const order = SYSTEM_ORDER_IDS as readonly string[];
    for (const b of bridges) {
      const [a, c] = b.id.slice('star.bridge.'.length).split('+');
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(c));
      expect(b.requires).toEqual([`star.major.${a}`, `star.major.${c}`]);
      expect(b.bridgeOf).toBeDefined();
    }
    expect(r0.filter((s) => s.kind2 === 'minor').length).toBeGreaterThan(0);
    expect(r0.length).toBeGreaterThanOrEqual(12);
  });
});
