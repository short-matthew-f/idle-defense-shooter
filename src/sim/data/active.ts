/**
 * Active-edge tuning table (docs/ACTIVE.md): tap-to-assist, salvage crates and Overcharge. Every number the
 * three active pieces use lives here; systems/active.ts, the sim-cli active policy, the UI widgets
 * (src/ui/active.ts) and the tests read this one table.
 *
 * Pillars: active play is an edge, never a toll; absence is never punished (uncollected crates still pay
 * PASSIVE_VALUE at the tower, the Overcharge meter never decays); no dailies or streaks.
 */
export const ACTIVE = {
  assist: {
    /** Seconds between two assist shots (sim time). Taps inside the cooldown do nothing (no queue, no error). */
    cooldown: 0.6,
    /** Damage per assist shot as a multiple of the primary's current shot damage (ballistics.damage). */
    damageMul: 1.25,
    /** Crit chance bonus on top of ballistics.crit_chance (like manual aim). */
    critBonus: 0.1,
    /** Sim-side tap reach around an enemy centre: max(reach, radius + pad) world units. */
    reach: 32, pad: 12,
    /** Overcharge meter points per assist hit. */
    meterPerTap: 3,
    /** Tracer lifetime (ticks). */
    tracerTicks: 9,
  },
  salvage: {
    /** First wave that drops crates. */
    fromWave: 2,
    /** Drop chance per kill: ordinary, elite, boss (a clump rolls as ordinary but carries its merged Scrap). */
    chance: 0.05, eliteChance: 0.35, bossChance: 1,
    /** A crate is worth this many times its kill's Scrap (uniform, own PRNG stream). */
    valueMin: 4, valueMax: 8,
    /** Seconds a crate drifts from the kill to the tower (every crate lives exactly this long). */
    lifeSeconds: 5,
    /** Live crates at most; drops beyond the cap are skipped. */
    maxLive: 6,
    /** Sim-side tap reach around a crate (world units). The UI reach is at least 44 CSS px (app/pick.ts). */
    tapReach: 56,
    /** Collects within this many seconds of the previous one build the chain. */
    chainWindow: 1.5,
    /** Chain multiplier: 1 + chainStep × (links − 1), at most chainMax. */
    chainStep: 0.5, chainMax: 3,
    /** Fraction of a crate's value the passive collector pays when the crate reaches the tower. */
    passiveValue: 0.4,
  },
  overcharge: {
    /** Unlock: deepest wave ever (or this run) ≥ this (progression feature `overcharge`). */
    unlockWave: 12,
    meterMax: 100,
    /** Meter points per landed primary hit, at most shotCapPerSecond per second from shots (token bucket). */
    meterPerHit: 1, shotCapPerSecond: 4,
    /** Hold time (s, real-time: sim ticks ÷ speed multiplier) at which the charge ring meets the target ring. */
    chargeSeconds: 1.0,
    /** The perfect window (s of hold). Releases outside it still fire, at weakMul. */
    perfectFrom: 0.75, perfectTo: 1.2,
    /** Holding this long releases automatically (weak). */
    maxHoldSeconds: 2.2,
    /** Volley damage per enemy on the line, in primary shots. */
    perfectMul: 5, weakMul: 2.5,
    /** Beam half-width (world units, added to the enemy radius) and reach. */
    beamHalfWidth: 26, beamLength: 560,
    /** Stagger on every enemy the beam hits (s; bosses: interrupt only, like EMP). Perfect only gets the full value. */
    staggerSeconds: 1.0, weakStaggerSeconds: 0.4,
    /** Beam visual lifetime (ticks). */
    beamTicks: 22,
  },
} as const;
