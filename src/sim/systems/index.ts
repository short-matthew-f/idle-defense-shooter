/**
 * System registry. Each work package adds its systems here; order matters and
 * is fixed by design: movement/status ticks → primary → hardpoints → elements/
 * fusions → linkages → anomalies → bastion/reactor → cleanup.
 */
import type { System } from '../core/system';

export const SYSTEM_ORDER: (() => System)[] = [
  // WP1: () => new Ballistics(),
];
