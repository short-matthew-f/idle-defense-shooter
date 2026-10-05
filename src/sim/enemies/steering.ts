/**
 * Basic enemy movement and attacks (WP1). WP5 extends behaviors in enemies/ai.ts.
 *
 * Formation enemies (spawnIdx >= 0) follow `formationPosition()` driven by their own formation
 * clock `formT` (ticks), which advances by `speedMul` each tick — so chill/freeze slow the script
 * itself, and knockback leaves the enemy behind its slot (it catches up at +25% speed).
 * Free-roaming enemies (adds, fragments) walk straight at the tower.
 *
 * Contact: within TOWER_RADIUS + radius + 4 of the tower an enemy stops and hits for
 * contactDamage × 1.06^wave once per second; kamikazes detonate once and are removed (no Scrap).
 * Bosses advance to radius 160, stop, and fire a hostile shot every 2 s once within 320.
 * Ranged enemies hold at 240 and fire every 2.5 s (while Rushing, run/stall.ts, they close to contact instead).
 */
import type { World } from '../core/world';
import { EnemyFlag, Ev, ProjFlag, ProjKind, TICK_DT, TICK_RATE, TOWER_RADIUS, INNER_RING } from '../core/types';
import { formationPosition } from './formations';
import { growth } from '../math/lut';
import { CONTACT_GROWTH } from '../economy/curves';

const SCR = new Float32Array(2);
const CATCHUP = 1.25;
const BOSS_HOLD = 160, BOSS_FIRE_RANGE = 320, BOSS_FIRE_TICKS = 2 * TICK_RATE, BOSS_SHOT = 10;
const RANGED_HOLD = 240, RANGED_FIRE_TICKS = 150;
const SHOT_SPEED = 170;

export function steerEnemy(world: World, i: number): void {
  const e = world.enemies;
  const f = e.flags[i];
  if (f & (EnemyFlag.Dead | EnemyFlag.Ally)) return;
  if (e.attackT[i] > 0) e.attackT[i]--;
  let m = e.speedMul[i];
  const x = e.x[i], y = e.y[i];
  const d = Math.sqrt(x * x + y * y);
  const contactR = TOWER_RADIUS + e.radius[i] + 4;

  if (f & (EnemyFlag.Boss | EnemyFlag.Ranged)) {
    const boss = (f & EnemyFlag.Boss) !== 0;
    const hold = e.rushT[i] > 0 ? contactR : boss ? BOSS_HOLD : RANGED_HOLD;   // anti-stall Rush / boss step-in: no standing off
    if (d > hold && m > 0) moveToward(world, i, 0, 0, e.speed[i] * m, hold);
    else { e.vx[i] = 0; e.vy[i] = 0; }
    if (e.staggerT[i] === 0 && e.frozenT[i] === 0 && d <= (boss ? BOSS_FIRE_RANGE : RANGED_HOLD + 20) && e.attackT[i] === 0) {
      e.attackT[i] = boss ? BOSS_FIRE_TICKS : RANGED_FIRE_TICKS;
      const dmg = (boss ? BOSS_SHOT : e.contact[i]) * growth(CONTACT_GROWTH, world.run.wave);
      const nd = d > 1e-6 ? d : 1;
      world.spawnProjectile({ kind: ProjKind.EnemyShot, flags: ProjFlag.Hostile, x, y, vx: (-x / nd) * SHOT_SPEED, vy: (-y / nd) * SHOT_SPEED,
        damage: dmg, radius: boss ? 7 : 5, life: 10 * TICK_RATE, target: i, cause: e.spawnEv[i], srcTag: 'enemy' });
    }
    return;
  }

  if (d <= contactR) {
    e.vx[i] = 0; e.vy[i] = 0;
    if (e.attackT[i] === 0 && e.staggerT[i] === 0 && e.frozenT[i] === 0) contactAttack(world, i);
    return;
  }
  if (m <= 0) { e.vx[i] = 0; e.vy[i] = 0; return; }
  if ((f & EnemyFlag.Kamikaze) && d < INNER_RING) m *= 1.5;

  const wave = world.wave, si = e.spawnIdx[i];
  if (wave && si >= 0 && si < wave.spawns.length) {
    e.formT[i] += m;
    const sp = wave.spawns[si];
    formationPosition(wave, sp, sp.tick + e.formT[i], e.speed[i], SCR);
    moveToward(world, i, SCR[0], SCR[1], e.speed[i] * m * CATCHUP, contactR);
  } else {
    moveToward(world, i, 0, 0, e.speed[i] * m, contactR);
  }
}

/** Step toward (tx,ty) at `speed` units/s without entering the tower's `minR` ring. */
function moveToward(world: World, i: number, tx: number, ty: number, speed: number, minR: number): void {
  const e = world.enemies;
  const x = e.x[i], y = e.y[i];
  const dx = tx - x, dy = ty - y;
  const l = Math.sqrt(dx * dx + dy * dy);
  const step = speed * TICK_DT;
  let nx = x, ny = y;
  if (l > 1e-6) { const k = l <= step ? 1 : step / l; nx = x + dx * k; ny = y + dy * k; }
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r < minR && r > 1e-6) { nx *= minR / r; ny *= minR / r; }
  e.vx[i] = (nx - x) / TICK_DT; e.vy[i] = (ny - y) / TICK_DT;
  e.x[i] = nx; e.y[i] = ny;
}

function contactAttack(world: World, i: number): void {
  const e = world.enemies;
  const dmg = e.contact[i] * growth(CONTACT_GROWTH, world.run.wave) * Math.max(1, e.clumpCount[i]);
  if (e.flags[i] & EnemyFlag.Kamikaze) {
    const id = world.emit(Ev.Explosion, 'kamikaze', 24, dmg, e.x[i], e.y[i], e.spawnEv[i]);
    world.damageTower(dmg, i, id);
    world.despawnEnemy(i);
    return;
  }
  e.attackT[i] = TICK_RATE;
  world.damageTower(dmg, i, e.spawnEv[i]);
}
