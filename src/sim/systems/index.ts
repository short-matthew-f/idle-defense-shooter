/**
 * System registry. Each work package adds its systems here; order matters and
 * is fixed by design: movement/status ticks → primary → hardpoints → elements/
 * fusions → linkages → anomalies → bastion/reactor → cleanup.
 */
import type { System } from '../core/system';
import { BallisticsSystem } from './ballistics';
import { OrdnanceSystem } from './ordnance';     // WP3
import { DronesSystem } from './drones';         // WP3
import { BladeSystem } from './blade';           // WP3
import { LaserSystem } from './laser';           // WP3
import { GraviticsSystem } from './gravitics';   // WP3
import { LinkagesSystem } from './linkages';     // WP3
import { InfusionsSystem } from './infusions';   // WP3
import { BossSystem } from '../enemies/bosses';   // WP5
import { ElementsSystem } from './elements';     // WP2
import { FusionsSystem } from './fusions';       // WP2
import { AnomaliesSystem } from './anomalies';   // WP8
import { BoonsSystem } from './boons';           // Boons (attempt-scoped rewards)
import { ProgressionSystem } from '../run/prestige';   // WP8
import { BastionSystem } from './bastion';       // WP2
import { ReactorSystem } from './reactor';       // WP2
import { AbilitiesSystem } from './abilities';
import { DirectivesSystem } from '../directives/engine';

export const SYSTEM_ORDER: (() => System)[] = [
  () => new BossSystem(),                       // WP5: boss controllers + Counter observer (first: sees every cast/designate)
  () => new BallisticsSystem(),                 // WP1: primary weapon
  () => new OrdnanceSystem(),                   // WP3: hardpoints in design order
  () => new DronesSystem(),                     // WP3
  () => new BladeSystem(),                      // WP3
  () => new LaserSystem(),                      // WP3
  () => new GraviticsSystem(),                  // WP3
  () => new ElementsSystem(),                   // WP2: Fire/Lightning/Poison/Frost procs and doctrines
  () => new FusionsSystem(),                    // WP2: Fusions and Triads
  () => new LinkagesSystem(),                   // WP3: weapon + chassis Linkages (after elements/fusions)
  () => new InfusionsSystem(),                  // WP3: Infusion twists
  () => new AnomaliesSystem(),                  // WP8: Anomalies, Prestige IV combat nodes, Pacifist Core
  () => new BoonsSystem(),                      // Boons: mechanical boons (data/boons.ts; stat boons resolve in core/stats.ts)
  () => new ProgressionSystem(),                // WP8: Codex, Forecast, Trials, blueprints, checkpoint bookkeeping
  () => new BastionSystem(),                    // WP2: Bastion doctrines
  () => new ReactorSystem(),                    // WP2: Reactor doctrines and exotic
  // WP9: keep these two LAST (after bastion/reactor): abilities/CE, then Directives/Autocast/Upgrade Queue
  () => new AbilitiesSystem(),
  () => new DirectivesSystem(),
];
