/**
 * Reachability regression guard (docs/reviews/REACHABILITY.md). The bug class: the sim grants a capability or a decision
 * and the phone UI has no control for it (Borrowed Blade's base nodes, a second Doctrine, a third ability slot, a second
 * designator). This test fails when
 *   - a Command type has no sender in src/ui or src/app (and is not on the INTERNAL allowlist), or validate.ts forgot it;
 *   - a content id (tree node, Doctrine, Anomaly, Boon, Frame, Trial, Prestige / Constellation node, ability, enemy, boss,
 *     sector, hardpoint, element, targeting profile) has no display name, blurb or icon in the UI tables;
 *   - a Prestige node, Anomaly, Frame or Trial reward is not classified here as automatic or as reached by a named
 *     control, or the control's marker is gone from its file (so a new capability must be wired, or consciously listed);
 *   - a UiState field is never read by the UI (allowlist below says why for the few that are not).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateCommand } from '../../src/sim/run/validate';
import {
  ABILITIES, ANOMALIES, BOONS, BOSSES, CHASSIS_LINKAGES, FRAMES, FUSIONS, INFUSIONS, PRESTIGE_NODES, SECTORS, STAR_NODES,
  SYSTEM_ORDER_IDS, TREES, TRIADS, TRIALS, WEAPON_LINKAGES,
} from '../../src/sim/data/index';
import { KINDS } from '../../src/sim/data/enemies';
import { TARGETING_PROFILES as SIM_PROFILES } from '../../src/sim/directives/targeting-profiles';
import { ELEMENTS, ELEMENT_BLURB, ENEMY_NAME, HARDPOINTS, HARDPOINT_BLURB, NODE_BY_ID, TREE_LABEL, sectorName } from '../../src/ui/content';
import { hasIcon } from '../../src/ui/icons';
import { SYSTEM_LABELS, TARGETING_PROFILES } from '../../src/ui/directive-model';
import { RARITY_LABEL } from '../../src/ui/draft';
import { CATEGORY_LABEL, RARITY_LABEL as BOON_RARITY_LABEL } from '../../src/ui/boons';
import { LAYERS } from '../../src/ui/prestige-shop';
import { SECOND_SOURCE_LABEL } from '../../src/ui/doctrine';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${f}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (f.endsWith('.ts')) out.push(rel);
  }
  return out;
}
/** UI and app sources (sim-client.ts only forwards commands, it never originates one). */
const UI_FILES = [...walk('src/ui'), ...walk('src/app')].filter((f) => !f.endsWith('sim-client.ts'));
const UI_SRC = UI_FILES.map(read).join('\n');
const UI_AND_AUDIO_SRC = UI_SRC + '\n' + walk('src/audio').map(read).join('\n');
const TYPES = read('src/sim/core/types.ts');

/** The Command union's `type` literals, parsed from core/types.ts. */
function commandTypes(): string[] {
  const start = TYPES.indexOf('export type Command =');
  const end = TYPES.indexOf('// Events (sim', start);
  const block = TYPES.slice(start, end);
  return [...new Set([...block.matchAll(/\|\s*\{\s*type:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
}

/**
 * Commands no player control sends, and why. Everything else must have a sender.
 */
const INTERNAL: Record<string, string> = {
  designate: 'Issued by Directives (viaDirective) and by the sim itself for designate_at; a player tap sends designate_at, which picks the slot, fills, replaces or clears',
};

describe('every Command has a sender', () => {
  const types = commandTypes();
  it('parses the Command union', () => {
    expect(types.length).toBeGreaterThanOrEqual(34);
    for (const t of ['buy', 'choose_doctrine', 'designate_at', 'set_threat_dial', 'clear_second_doctrine', 'delete_blueprint', 'decline_boon']) expect(types).toContain(t);
  });
  it.each(types)('%s is sent by src/ui or src/app (or is internal)', (t) => {
    const sent = new RegExp(`type:\\s*'${t}'`).test(UI_SRC);
    if (INTERNAL[t]) expect(INTERNAL[t].length).toBeGreaterThan(10);
    else expect(sent, `no UI sender for command '${t}'`).toBe(true);
  });
  it.each(types)('%s is known to validate.ts', (t) => {
    expect(String(validateCommand({ type: t }))).not.toMatch(/^Unknown command/);
  });
});

describe('every content id has a display name, blurb or icon', () => {
  it('trees, nodes, Doctrines and capstones', () => {
    for (const t of TREES) {
      expect(TREE_LABEL[t.id], t.id).toBeTruthy();
      for (const n of [...t.shared, ...t.doctrines.flatMap((d) => d.nodes), t.exotic]) {
        expect(n.name, n.id).toBeTruthy();
        expect(n.desc, n.id).toBeTruthy();
        expect(NODE_BY_ID.get(n.id), n.id).toBeDefined();
      }
      for (const d of t.doctrines) {
        expect(d.name && d.identity, `${t.id}.${d.id}`).toBeTruthy();
        expect(NODE_BY_ID.get(d.capstone)?.name, `${t.id}.${d.id} capstone`).toBeTruthy();
      }
    }
    for (const n of [...FUSIONS, ...TRIADS, ...WEAPON_LINKAGES, ...CHASSIS_LINKAGES, ...INFUSIONS].map((x) => x.node)) expect(NODE_BY_ID.get(n.id)?.name, n.id).toBeTruthy();
  });
  it('Anomalies, Boons, Frames, Trials', () => {
    for (const a of ANOMALIES) {
      expect(a.name && a.desc, a.id).toBeTruthy();
      expect(RARITY_LABEL[a.rarity], a.id).toBeTruthy();
      expect(hasIcon(`r_${a.rarity}`), a.id).toBe(true);
      for (const n of a.needs ?? []) expect(n === 'primary' || !!TREE_LABEL[n as keyof typeof TREE_LABEL], `${a.id} needs ${n}`).toBe(true);
    }
    expect(BOONS.length).toBe(36);
    for (const b of BOONS) {
      expect(b.name && b.desc && b.short, b.id).toBeTruthy();
      expect(CATEGORY_LABEL[b.category] && BOON_RARITY_LABEL[b.rarity], b.id).toBeTruthy();
      expect(hasIcon(`c_${b.category}`), b.id).toBe(true);
    }
    expect(FRAMES.length).toBe(9);
    for (const f of FRAMES) expect(f.name && f.trait && f.unlock, f.id).toBeTruthy();
    expect(TRIALS.length).toBe(10);
    for (const t of TRIALS) expect(t.name && t.constraint && t.reward, t.id).toBeTruthy();
  });
  it('Prestige and Constellation nodes, abilities', () => {
    expect(PRESTIGE_NODES.length).toBe(38);
    for (const p of PRESTIGE_NODES) {
      expect(p.name && p.desc, p.id).toBeTruthy();
      expect(LAYERS.some((l) => l.layer === p.layer), p.id).toBe(true);
    }
    for (const s of STAR_NODES) expect(s.name && s.desc, s.id).toBeTruthy();
    for (const a of ABILITIES) {
      expect(a.name && a.desc, a.id).toBeTruthy();
      expect(hasIcon(`a_${a.id}`), `icon for ${a.id}`).toBe(true);
      expect(NODE_BY_ID.get(a.rankNode.id)?.name, a.rankNode.id).toBeTruthy();
    }
    expect(hasIcon('a_designate')).toBe(true);
  });
  it('enemies, bosses, sectors, systems, elements, targeting profiles, second-Doctrine sources', () => {
    for (const k of KINDS) expect(ENEMY_NAME.get(k), k).toBeTruthy();
    for (const b of BOSSES) expect(b.name && b.tell.name, b.id).toBeTruthy();
    for (const s of SECTORS) expect(sectorName(s.id)).not.toBe(s.id);
    for (const h of HARDPOINTS) expect(HARDPOINT_BLURB[h] && TREE_LABEL[h], h).toBeTruthy();
    for (const e of ELEMENTS) expect(ELEMENT_BLURB[e] && TREE_LABEL[e], e).toBeTruthy();
    for (const s of SYSTEM_ORDER_IDS) expect(SYSTEM_LABELS[s], s).toBeTruthy();
    expect(TARGETING_PROFILES.map((p) => p.value).sort()).toEqual([...SIM_PROFILES].sort());
    for (const k of ['monolith', 'bulwark', 'singularity_core', 'dual_doctrine', 'spare_barrel'] as const) expect(SECOND_SOURCE_LABEL[k]).toBeTruthy();
  });
});

// ------------------------------------------------------------------ capabilities → controls
type Reach = { auto: string } | { ui: [file: string, marker: string]; how: string };
const auto = (why: string): Reach => ({ auto: why });
const ui = (file: string, marker: string, how: string): Reach => ({ ui: [file, marker], how });

/** Every Prestige node: automatic, or the control that reaches it. */
const PRESTIGE: Record<string, Reach> = {
  'prestige.seed_capital': auto('Scrap at run start'),
  'prestige.memory_of_steel': auto('free Caliber ranks at run start'),
  'prestige.memory_of_motion': auto('free Autoloader ranks at run start'),
  'prestige.accelerated_clearing': ui('src/ui/hud.ts', 'speedAllowed', 'automatic speed at wave start; the speed chip shows (and can lower) it'),
  'prestige.boss_bounty': auto('boss Scrap'),
  'prestige.checkpoint_dividend': auto('checkpoint bonus'),
  'prestige.scrap_resonance': auto('Scrap multiplier'),
  'prestige.hardened_core': auto('max HP'),
  'prestige.frames': ui('src/ui/prestige.ts', 'frameCards', 'Prestige modal Frame cards'),
  'prestige.blueprint_slots': ui('src/ui/directives.ts', "type: 'delete_blueprint'", 'More → Automation → Blueprints (save, overwrite, delete); load in the Prestige modal'),
  'prestige.weapon_seed': ui('src/ui/build.ts', 'nextHardpointWave', 'automatic; the Build slot rows say when slots open'),
  'prestige.elemental_memory': ui('src/ui/build.ts', 'nextAttunementWave', 'automatic; the Build slot rows say when slots open'),
  'prestige.early_hardpoints': ui('src/ui/build.ts', 'nextHardpointWave', 'automatic; the Build slot rows say when slots open'),
  'prestige.third_attunement': ui('src/ui/build.ts', 'slotCaps', 'automatic cap; Build shows it'),
  'prestige.keepsake': ui('src/ui/prestige.ts', 'keepsake', 'Prestige modal Keepsake picker'),
  'prestige.anomaly_socket': auto('socket count (Build shows sockets)'),
  'prestige.branch_discount': ui('src/ui/prestige.ts', 'discountTree', 'Prestige modal Branch Discount picker'),
  'prestige.autocast': ui('src/ui/build.ts', 'autocastOff', 'Build → Abilities: Auto on / off per ability'),
  'prestige.trials': ui('src/ui/trials.ts', "type: 'start_trial'", 'More → Trials'),
  'prestige.directives': ui('src/ui/directives.ts', "type: 'set_directives'", 'More → Automation (Directives, Targeting, Upgrade Queue)'),
  'prestige.third_tactical_slot': ui('src/ui/abilities.ts', 'abilitySlots', 'a third ability button (and Build row) appears; toast'),
  'prestige.threat_dial': ui('src/ui/build.ts', "type: 'set_threat_dial'", 'Prestige modal slider; Build → Threat Dial → Lower'),
  'prestige.directive_tuning': ui('src/ui/directives.ts', 'reactionDelay', 'automatic; the Directives tab shows the delay'),
  'prestige.long_patrol': auto('offline cap and efficiency'),
  'prestige.speed_controls': ui('src/ui/hud.ts', "type: 'set_speed'", 'Battle speed chip'),
  'prestige.expanded_frame': ui('src/ui/build.ts', 'slotCaps', 'automatic cap; Build and the Prestige modal show it'),
  'prestige.dual_doctrine': ui('src/ui/doctrine.ts', 'second: true', 'Doctrine fork: Choose as 2nd (one tree); Clear 2nd moves it'),
  'prestige.duplication': auto('primary duplicates'),
  'prestige.double_launch': auto('missiles'),
  'prestige.conscription': auto('elite allies'),
  'prestige.overflow': auto('status caps'),
  'prestige.reversal': auto('blade reverses'),
  'prestige.ghost_edges': auto('laser edges'),
  'prestige.critical_relay': auto('cooldowns'),
  'prestige.held_open': auto('weak points'),
  'prestige.relay_fire': auto('drones'),
  'prestige.autonomy': ui('src/ui/settings.ts', "key: 'autoPrestige'", 'Directives: Prestige action and Adept conditions; Settings → Auto-Prestige'),
  'prestige.paradox_pool': auto('draft weights'),
};

/** Every Anomaly: automatic, or the control the player uses it with. */
const ANOMALY: Record<string, Reach> = {
  spare_barrel: ui('src/ui/doctrine.ts', 'second: true', 'Ballistics Doctrine fork: Choose as 2nd (50%)'),
  borrowed_blade: ui('src/ui/shop.ts', 'extraSystems', 'Upgrades → Hardpoints: Orbital Blade · borrowed chip; Build row; mountable into a slot'),
  recursive_warhead: ui('src/ui/shop.ts', 'recursive_warhead', 'automatic; the Ordnance Exotic says it is already granted'),
  second_opinion: ui('src/ui/hud.ts', 'designators', 'tap two enemies; the HUD shows the 2 designators'),
  loaded_dice: auto('crit rolls'), seventh_shot: auto('primary'), mirror_node: auto('laser'), pinball: auto('ricochets'), stormglass: auto('arcs'),
  clockwork_blade: auto('blade'), ghost_protocol: auto('drone kills rise'), rogue_moon: auto('orbiting mass'), cold_iron: auto('chill'),
  heavy_water: auto('poison'), overcharged_capacitor: auto('CE cap'), glass_cannon: auto('stats'), unstable_isotope: auto('explosions'),
  tithe: auto('boss Cores'), hungry_core: auto('healing'), afterimage_round: auto('primary'), echo_chamber: auto('explosions'),
  feedback_loop: auto('abilities recast'), rot_bloom: auto('poison clouds'), smolder: auto('durations'), martyr_plating: auto('retaliation'),
};

/** Every Frame: how the player picks it, plus its extra capability. */
const FRAME: Record<string, Reach> = {
  standard: ui('src/ui/prestige.ts', 'frameCards', 'Prestige modal'),
  arsenal: ui('src/ui/prestige.ts', 'frameCards', 'Prestige modal (Frames node)'),
  conductor: ui('src/ui/prestige.ts', 'frameCards', 'Prestige modal (Frames node)'),
  monolith: ui('src/ui/doctrine.ts', 'second: true', 'second Barrel Doctrine at full strength'),
  hive: ui('src/ui/shop.ts', 'mountBlocked', 'Drones free mount: listed as a Frame system; not offered in slot pickers'),
  bulwark: ui('src/ui/doctrine.ts', 'second: true', 'second Bastion Doctrine at full strength'),
  echo_engine: ui('src/ui/prestige.ts', 'frameCards', 'Prestige modal (Ascension I)'),
  prism: ui('src/ui/shop.ts', 'mountBlocked', 'Laser free mount'),
  singularity_core: ui('src/ui/doctrine.ts', 'second: true', 'a second Doctrine in every tree at 60%'),
};

/** Every Trial reward. */
const TRIAL_REWARD: Record<string, Reach> = {
  bare_metal: ui('src/ui/prestige.ts', 'frameCards', 'Monolith Frame'),
  hive_mind: ui('src/ui/prestige.ts', 'frameCards', 'Hive Frame'),
  siege_mentality: ui('src/ui/prestige.ts', 'frameCards', 'Bulwark Frame'),
  monochrome: auto('+1 stack cap'),
  blackout: auto('Autocast / Directive efficiency'),
  commander: ui('src/ui/hud.ts', 'designators', 'second designator'),
  scatter: auto('Gravitics Exotic price 0'),
  swarmstorm: auto('Critical Mass threshold'),
  poverty: auto('Strip Mine ×5'),
  pacifist_core: auto('Rot Anomaly pool in drafts'),
};

function checkTable(name: string, ids: readonly string[], table: Record<string, Reach>): void {
  it(`${name}: every id is classified and every control marker exists`, () => {
    expect(Object.keys(table).sort()).toEqual([...ids].sort());
    for (const [id, r] of Object.entries(table)) {
      if ('auto' in r) { expect(r.auto.length, id).toBeGreaterThan(0); continue; }
      const [file, marker] = r.ui;
      expect(read(file).includes(marker), `${id}: "${marker}" missing from ${file} (${r.how})`).toBe(true);
    }
  });
}

describe('capabilities reach a control', () => {
  checkTable('Prestige nodes', PRESTIGE_NODES.map((p) => p.id), PRESTIGE);
  checkTable('Anomalies', ANOMALIES.map((a) => a.id), ANOMALY);
  checkTable('Frames', FRAMES.map((f) => f.id), FRAME);
  checkTable('Trial rewards', TRIALS.map((t) => t.id), TRIAL_REWARD);
});

// ------------------------------------------------------------------ UiState fields
/** UiState fields the UI does not read, and why. */
const UNREAD: Record<string, string> = {
  stats: 'damage share by source: a simulator / agent metric (sim-cli), not a player control',
  recentEvents: 'the UI consumes event batches (GameUi.onEvents) instead',
  'run.attempts': 'informational; attempts per checkpoint feed the Forecast in the sim',
  'wave.enemiesTotal': 'folded into wave.progress',
  'wave.spawned': 'folded into wave.progress',
  'wave.formation': 'informational (the Codex and hints name formations)',
};

function uiStateKeys(): string[] {
  const start = TYPES.indexOf('export interface UiState {');
  const end = TYPES.indexOf('\n}\n', start);
  const body = TYPES.slice(start, end);
  const keys: string[] = [];
  let depth = 0;
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s{2}([a-zA-Z]+)\??:/.exec(line);
    if (depth === 0 && m) keys.push(m[1]);
    for (const ch of line) { if (ch === '{' || ch === '<') depth++; else if (ch === '}' || ch === '>') depth = Math.max(0, depth - 1); }
    if (/=>/.test(line)) depth = Math.max(0, depth - (line.match(/=>/g)?.length ?? 0));
  }
  return keys;
}

describe('UiState fields are read by the UI', () => {
  const keys = uiStateKeys();
  it('parses UiState', () => { for (const k of ['run', 'build', 'secondDoctrine', 'abilitySlots', 'designators', 'mountBlocked', 'slotCaps', 'extraSystems']) expect(keys).toContain(k); });
  it.each(keys)('%s', (k) => {
    if (UNREAD[k]) return;
    expect(new RegExp(`\\.${k}\\b`).test(UI_AND_AUDIO_SRC), `UiState.${k} is never read in src/ui, src/app or src/audio`).toBe(true);
  });
  it('run.* and wave.* sub-fields', () => {
    const runPick = /run: Pick<RunState, ([^>]+)>/.exec(TYPES)![1];
    const runKeys = [...runPick.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).concat(['boons', 'boonQueueLength', 'boonCap', 'boonRerollCost']);
    const waveKeys = [...(/wave: \{ ([^}]+) \};/.exec(TYPES)![1]).matchAll(/([a-zA-Z]+):/g)].map((m) => m[1]);
    const missing: string[] = [];
    for (const k of runKeys) if (!UNREAD[`run.${k}`] && !new RegExp(`\\.${k}\\b`).test(UI_AND_AUDIO_SRC)) missing.push(`run.${k}`);
    for (const k of waveKeys) if (!UNREAD[`wave.${k}`] && !new RegExp(`\\.${k}\\b`).test(UI_AND_AUDIO_SRC)) missing.push(`wave.${k}`);
    expect(missing).toEqual([]);
  });
});
