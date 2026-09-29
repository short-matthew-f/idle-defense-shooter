/**
 * System registry. Each work package adds its systems here; order matters and
 * is fixed by design: movement/status ticks → primary → hardpoints → elements/
 * fusions → linkages → anomalies → bastion/reactor → cleanup.
 */
import type { System } from '../core/system';
import { BallisticsSystem } from './ballistics';

export const SYSTEM_ORDER: (() => System)[] = [
  () => new BallisticsSystem(),                 // WP1: primary weapon
];
