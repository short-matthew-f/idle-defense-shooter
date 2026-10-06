/** Phase 3 tell-window assist (meta.settings.tellAssist): boss tell windows ×1.5 when on, unchanged when off; saves. */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/index';
import { bossHp } from '../../src/sim/economy/curves';
import { bossDef } from '../../src/sim/core/content';
import { TELL_ASSIST_MULT, tellWindowTicks } from '../../src/sim/data/bosses';
import { validateCommand } from '../../src/sim/run/validate';
import { exportString, importString } from '../../src/sim/save/serialize';
import type { BossId } from '../../src/sim/core/ids';

function bossSim(id: BossId, wave: number, assist: boolean | null, seed = 3): Sim {
  const sim = new Sim(null, seed);
  const w = sim.world, s = w.stats;
  const def = bossDef(id, wave);
  s.override('ballistics.damage', (bossHp(wave, def.hpMul, 0, 0) / 4000) * (1 + def.armor / 100));
  s.override('bastion.max_hp', 1e12);
  w.rebuildStats();
  w.tower.hp = w.tower.maxHp;
  w.meta.echoes = 1e12;
  if (assist !== null) sim.command({ type: 'set_setting', key: 'tellAssist', value: assist });
  w.run.wave = wave;
  sim.machine.startWave();
  return sim;
}

/** Ticks the first tell window stays open. */
function firstWindow(sim: Sim): number {
  const w = sim.world;
  let t = 0;
  while (w.bossTell.ability === null && t < 3600) { sim.step(); t++; }
  expect(w.bossTell.ability, 'tell opened').not.toBeNull();
  let open = 0;
  while (w.bossTell.ability !== null && open < 3600) { sim.step(); open++; }
  return open;
}

describe('tell-window assist', () => {
  it('tellWindowTicks: ×1.5 with the assist, unchanged without', () => {
    expect(TELL_ASSIST_MULT).toBe(1.5);
    expect(tellWindowTicks(1, false)).toBe(60);
    expect(tellWindowTicks(1, undefined)).toBe(60);
    expect(tellWindowTicks(1, true)).toBe(90);
    expect(tellWindowTicks(1.3, true)).toBe(Math.round(1.3 * 60 * 1.5));
  });

  it('a boss tell window lasts ×1.5 with the setting on and is unchanged with it off (or absent)', () => {
    const win = Math.round(bossDef('breaker', 5).tell.windowSeconds * 60);
    const absent = firstWindow(bossSim('breaker', 5, null));
    const off = firstWindow(bossSim('breaker', 5, false));
    const on = firstWindow(bossSim('breaker', 5, true));
    expect(absent).toBe(win);
    expect(off).toBe(win);
    expect(on).toBe(Math.round(win * 1.5));
  }, 30_000);

  it('set_setting validates the key and a boolean value', () => {
    expect(validateCommand({ type: 'set_setting', key: 'tellAssist', value: true })).toBeNull();
    expect(validateCommand({ type: 'set_setting', key: 'tellAssist', value: 1 })).not.toBeNull();
  });

  it('an old save without the key loads (off); the setting persists in saves', () => {
    const a = new Sim(null, 5);
    const save = a.save();
    delete (save.meta.settings as { tellAssist?: boolean }).tellAssist;
    const b = Sim.load(importString(exportString(save)));
    expect(b.world.meta.settings.tellAssist ?? false).toBe(false);
    b.command({ type: 'set_setting', key: 'tellAssist', value: true });
    b.step();
    const c = Sim.load(importString(exportString(b.save())));
    expect(c.world.meta.settings.tellAssist).toBe(true);
    const bad = b.save();
    (bad.meta.settings as Record<string, unknown>).tellAssist = 'yes';
    expect(Sim.load(importString(exportString(bad))).world.meta.settings.tellAssist).toBeUndefined();
  });
});
