/** Sound-effect registry: every SFX by id, with a dense numeric index for the rate limiter. */
import { COMBAT } from './combat';
import { ELEMENTS } from './elements';
import { SYSTEMS } from './systems';
import { ABILITY_SFX } from './abilities';
import { META } from './meta';
import type { SfxDef } from './types';

export type { SfxDef, SfxParams } from './types';

const ALL = { ...COMBAT, ...ELEMENTS, ...SYSTEMS, ...ABILITY_SFX, ...META } satisfies Record<string, SfxDef>;
export type SfxId = keyof typeof ALL;
export const SFX: Record<SfxId, SfxDef> = ALL;

export const SFX_IDS = Object.keys(SFX) as SfxId[];
/** Dense index per id (rate limiter slots); chain notes use index SFX_IDS.length + timbre. */
export const SFX_INDEX: Record<SfxId, number> = Object.fromEntries(SFX_IDS.map((id, i) => [id, i])) as Record<SfxId, number>;

export const SFX_GROUPS = {
  combat: Object.keys(COMBAT) as SfxId[],
  elements: Object.keys(ELEMENTS) as SfxId[],
  systems: Object.keys(SYSTEMS) as SfxId[],
  abilities: Object.keys(ABILITY_SFX) as SfxId[],
  meta: Object.keys(META) as SfxId[],
};

export function sfxDef(id: SfxId): SfxDef { return SFX[id]; }
