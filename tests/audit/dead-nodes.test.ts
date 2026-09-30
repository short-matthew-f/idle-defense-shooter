/**
 * Dead-node audit (docs/reviews/EFFECT-AUDIT.md): every purchasable / drafted content item and every effect stat key
 * must have a consumer in the sim (scripts/audit-dead-nodes.mjs does the scan; `npm run audit:nodes` prints it).
 * A dead entry is something a player can pay for or draft that does nothing. Accepted exceptions live in ALLOWLIST
 * (with a reason); an allowlisted entry that becomes live fails too, so the list cannot rot.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import { scanDeadNodes, deadEntries, ALLOWLIST } from '../../scripts/audit-dead-nodes.mjs';

interface Entry { kind: string; id: string; status: 'live' | 'alias' | 'dead'; consumers: string[]; note?: string }

describe('dead-node scan', async () => {
  const { entries } = (await scanDeadNodes()) as { entries: Entry[] };
  const allow = ALLOWLIST as Record<string, string>;

  it('covers every content group', () => {
    const kinds = new Set(entries.map((e) => e.kind));
    for (const k of ['tree-node', 'doctrine-node', 'capstone', 'exotic', 'ability-node', 'fusion', 'triad', 'linkage', 'infusion',
      'prestige', 'star', 'anomaly', 'boon', 'frame-flag', 'trial-constraint', 'trial-reward', 'effect-key']) expect(kinds.has(k), k).toBe(true);
    expect(entries.filter((e) => e.kind === 'anomaly').length).toBe(25);
    expect(entries.filter((e) => e.kind === 'boon').length).toBe(36);
    expect(entries.filter((e) => e.kind === 'prestige').length).toBe(38);
    expect(entries.filter((e) => e.kind === 'star').length).toBe(13);
    expect(entries.filter((e) => e.kind === 'capstone').length).toBe(36);
  });

  it('no dead node, Anomaly, boon, Frame flag, Trial rule or effect key outside the allowlist', () => {
    const dead = (deadEntries(entries) as Entry[]).filter((e) => !allow[e.id]).map((e) => `${e.kind} ${e.id}${e.note ? ` (${e.note})` : ''}`);
    expect(dead).toEqual([]);
  });

  it('every allowlist entry is still dead and says why', () => {
    for (const [id, why] of Object.entries(allow)) {
      expect(why.length, id).toBeGreaterThan(10);
      expect(entries.find((e) => e.id === id)?.status, `${id} is no longer dead: drop it from ALLOWLIST`).toBe('dead');
    }
  });

  it('display-only aliases are exactly the documented seven, each feeding a consumed key', () => {
    const aliases = entries.filter((e) => e.status === 'alias').map((e) => e.id).sort();
    expect(aliases).toEqual([
      'bastion.fortress.armor', 'bastion.fortress.hp', 'reactor.command.ce_cap', 'reactor.overclock.cooldowns',
      'reactor.overclock.speed', 'reactor.salvage.boss_scavenging', 'reactor.salvage.reclamation',
    ]);
  });
});
