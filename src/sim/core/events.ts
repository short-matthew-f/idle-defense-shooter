/**
 * Event log: preallocated ring buffer (no allocation per event), a rolling FNV-1a hash over the
 * whole stream (determinism tests), `byId` for the Inspector and `chain` for kill-chain sentences.
 *
 * Slot objects are REUSED: `byId` returns the live slot (do not keep it past the tick); `recent`
 * and `chain` return copies.
 *
 * Chain depth: every event stores a link depth. Root events have depth 1. A child adds one link
 * unless it continues its cause with the same src and is a Hit/Kill/StatusTick (so "the gun hit,
 * which killed" is one link, while "the drone shocked, which caused the lightning to jump" is two).
 * The deepest Kill chain is exposed as `longestKillChain` (the World copies it to run.longestChain).
 */
import type { EventLog as IEventLog, SimEvent } from './types';
import { Ev } from './types';
import { boonDef, bossDef, enemyDef } from './content';

export const EVENT_CAPACITY = 16384;

/** Enemy state bits carried in SimEvent.c for Hit/Kill (and in c>>8 for StatusApply). */
export const enum StateBit { Frozen = 1, Chilled = 2, Burning = 4, Poisoned = 8, Shocked = 16, Elite = 32, Boss = 64, Clump = 128,
  /** Audio-pass addition: set on Hit events only (never in StatusApply's c >> 8): the hit was a critical hit. Not hashed. */
  Crit = 256 }

/** Status index carried in StatusApply.c & 0xff. */
export const STATUS_NAMES = ['burn', 'shock', 'poison', 'chill', 'bleed', 'brittle', 'marked', 'static', 'frozen'] as const;
export const STATUS_INDEX: Record<string, number> = { burn: 0, shock: 1, poison: 2, chill: 3, bleed: 4, brittle: 5, marked: 6, static: 7, frozen: 8 };

function blank(): SimEvent {
  return { id: -1, tick: 0, type: Ev.Fx, cause: -1, src: '', a: 0, b: 0, x: 0, y: 0, data: undefined, c: 0 };
}

export class EventLogImpl implements IEventLog {
  nextId = 0;
  readonly capacity: number;
  private slots: SimEvent[];
  private depth: Uint16Array;
  private h = 0x811c9dc5;
  longestKillChain = 0;

  constructor(capacity = EVENT_CAPACITY) {
    this.capacity = capacity;
    this.slots = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.slots[i] = blank();
    this.depth = new Uint16Array(capacity);
  }

  push(e: Omit<SimEvent, 'id'>): number {
    return this.pushRaw(e.type, e.tick, e.src, e.a, e.b, e.c ?? 0, e.x, e.y, e.cause, e.data);
  }

  /** Allocation-free push used by the World. */
  pushRaw(type: Ev, tick: number, src: string, a: number, b: number, c: number, x: number, y: number, cause: number, data?: SimEvent['data']): number {
    const id = this.nextId++;
    const k = id % this.capacity;
    const s = this.slots[k];
    s.id = id; s.tick = tick; s.type = type; s.cause = cause; s.src = src; s.a = a; s.b = b; s.c = c; s.x = x; s.y = y; s.data = data;
    // rolling FNV-1a over (type, tick, a|0, b|0, src)
    let h = this.h;
    h = Math.imul(h ^ (type & 0xff), 0x01000193);
    h = mix32(h, tick | 0);
    h = mix32(h, a | 0);
    h = mix32(h, b | 0);
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193);
    this.h = h >>> 0;
    // chain depth
    let d = 1;
    const parent = this.byId(cause);
    if (parent) {
      const pd = this.depth[cause % this.capacity];
      const continues = parent.src === src && (type === Ev.Hit || type === Ev.Kill || type === Ev.StatusTick);
      d = pd + (continues ? 0 : 1);
      if (d > 65535) d = 65535;
    }
    this.depth[k] = d;
    if (type === Ev.Kill && d > this.longestKillChain) this.longestKillChain = d;
    return id;
  }

  hash(): number { return this.h >>> 0; }

  byId(id: number): SimEvent | undefined {
    if (id < 0 || id >= this.nextId || id < this.nextId - this.capacity) return undefined;
    return this.slots[id % this.capacity];
  }

  depthOf(id: number): number { return this.byId(id) ? this.depth[id % this.capacity] : 0; }

  /** Copies of buffered events with tick >= sinceTick, oldest first. */
  recent(sinceTick: number, limit = Infinity, filter?: (e: SimEvent) => boolean): SimEvent[] {
    const out: SimEvent[] = [];
    const lo = Math.max(0, this.nextId - this.capacity);
    // walk backwards to find the start quickly, then forwards
    let start = this.nextId;
    while (start > lo && this.slots[(start - 1) % this.capacity].tick >= sinceTick) start--;
    for (let id = start; id < this.nextId; id++) {
      const e = this.slots[id % this.capacity];
      if (filter && !filter(e)) continue;
      out.push(copy(e));
    }
    return out.length > limit ? out.slice(out.length - limit) : out;
  }

  /** Copies of events with id in [fromId, nextId) still buffered. */
  since(fromId: number): SimEvent[] {
    const out: SimEvent[] = [];
    for (let id = Math.max(fromId, this.nextId - this.capacity, 0); id < this.nextId; id++) out.push(copy(this.slots[id % this.capacity]));
    return out;
  }

  /**
   * Visit events with id in [fromId, toId) still buffered, without copying. Events the callback
   * emits (ids >= toId) are not visited. Pass a long-lived callback (not a per-call closure) from
   * per-tick code.
   */
  forEachRange(fromId: number, toId: number, fn: (e: SimEvent) => void): void {
    for (let id = Math.max(fromId, this.nextId - this.capacity, 0); id < toId; id++) fn(this.slots[id % this.capacity]);
  }

  /** Visit events with id in [fromId, nextId) without copying. */
  forEachSince(fromId: number, fn: (e: SimEvent) => void): void {
    for (let id = Math.max(fromId, this.nextId - this.capacity, 0); id < this.nextId; id++) fn(this.slots[id % this.capacity]);
  }

  /** Walk cause links from `eventId` to the root; returns root-first copies and a sentence. */
  chain(eventId: number): { chain: SimEvent[]; sentence: string } {
    const rev: SimEvent[] = [];
    let id = eventId;
    let guard = 0;
    while (guard++ < 256) {
      const e = this.byId(id);
      if (!e) break;
      rev.push(copy(e));
      if (e.cause < 0 || e.cause >= id) break;
      id = e.cause;
    }
    const chain = rev.reverse();
    return { chain, sentence: chainSentence(chain) };
  }

  reset(): void {
    this.nextId = 0; this.h = 0x811c9dc5; this.longestKillChain = 0;
  }
}

function mix32(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  return Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
}

function copy(e: SimEvent): SimEvent {
  return { id: e.id, tick: e.tick, type: e.type, cause: e.cause, src: e.src, a: e.a, b: e.b, x: e.x, y: e.y, c: e.c ?? 0, ...(e.data ? { data: { ...e.data } } : {}) };
}

// ---------------------------------------------------------------------------
// Sentence builder
// ---------------------------------------------------------------------------
const NOUNS: Record<string, string> = {
  ballistics: 'gun', primary: 'gun', ordnance: 'missiles', drones: 'drone', blade: 'blade', laser: 'laser',
  gravitics: 'gravity well', fire: 'fire', burn: 'fire', lightning: 'lightning', static: 'lightning', poison: 'poison',
  frost: 'frost', chill: 'frost', frozen: 'frost', bleed: 'bleeding', bastion: 'tower', tower: 'tower', retaliation: 'tower',
  reactor: 'reactor', enemy: 'enemy', hazard: 'hazard', status: 'status',
  // Active edge (systems/active.ts)
  assist: 'assist shot', overcharge: 'overcharge', salvage: 'salvage', 'salvage.tap': 'salvage', 'salvage.passive': 'salvage collector',
};

/** Human noun for an event src tag. */
export function nounFor(src: string): string {
  if (NOUNS[src]) return NOUNS[src];
  const dot = src.indexOf('.');
  if (dot > 0) {
    const head = src.slice(0, dot), rest = src.slice(dot + 1);
    if (head === 'link' || head === 'chassis') return rest.split('+').map((p) => nounFor(p)).join('-') + ' link';
    if (head === 'infuse') { const [sys, el] = rest.split('.'); return `${el ?? ''} ${nounFor(sys)}`.trim(); }
    if (head === 'boon') { const d = boonDef(rest); return `${d ? d.name : rest.replace(/_/g, ' ')} boon`; }   // Boons: "the Volatile Kills boon"
    if (head === 'fusion' || head === 'triad' || head === 'ability' || head === 'anomaly' || head === 'star' || head === 'prestige') return rest.replace(/_/g, ' ');
    if (NOUNS[head]) return NOUNS[head];
    return rest.replace(/[_.]/g, ' ');
  }
  return src.replace(/_/g, ' ');
}

type Verb = [past: string, inf: string];
const HIT_VERBS: Record<string, Verb> = {
  lightning: ['jumped to', 'jump to'], static: ['jumped to', 'jump to'], laser: ['burned', 'burn'], blade: ['cut', 'cut'],
  ordnance: ['struck', 'strike'], fire: ['scorched', 'scorch'], burn: ['burned', 'burn'], poison: ['ate into', 'eat into'],
  frost: ['froze', 'freeze'], drones: ['shot', 'shoot'], ballistics: ['shot', 'shoot'], primary: ['shot', 'shoot'],
};
const STATUS_VERBS: Verb[] = [
  ['ignited', 'ignite'], ['shocked', 'shock'], ['poisoned', 'poison'], ['chilled', 'chill'], ['cut open', 'cut open'],
  ['made brittle', 'make brittle'], ['marked', 'mark'], ['charged', 'charge'], ['froze', 'freeze'],
];

function objectFor(bits: number): string {
  const who = (bits & StateBit.Boss) ? 'boss' : (bits & StateBit.Elite) ? 'elite' : (bits & StateBit.Clump) ? 'clump' : 'enemy';
  const adj = (bits & StateBit.Frozen) ? 'frozen ' : (bits & StateBit.Burning) ? 'burning ' : (bits & StateBit.Poisoned) ? 'poisoned '
    : (bits & StateBit.Shocked) ? 'shocked ' : (bits & StateBit.Chilled) ? 'chilled ' : '';
  return `the ${adj}${who}`;
}

/**
 * Display name of a Kill event's victim from its `data` ({ kind, elite, boss, bossId }):
 * "Brute", "elite Runner", "Warden (boss)". Null when the event carries no victim data.
 */
export function victimName(data: SimEvent['data']): string | null {
  if (!data || typeof data.kind !== 'string') return null;
  if (data.boss) {
    const id = typeof data.bossId === 'string' ? data.bossId : null;
    const name = id ? bossDef(id).name.replace(/^The\s+/i, '') : 'Boss';
    return `${name} (boss)`;
  }
  const name = enemyDef(data.kind).name || data.kind;
  return data.elite ? `elite ${name}` : name;
}

function killObject(e: SimEvent): string {
  const v = victimName(e.data);
  if (!v) return objectFor(e.c ?? 0);
  const bits = e.c ?? 0;
  const adj = (bits & StateBit.Frozen) ? 'frozen ' : (bits & StateBit.Burning) ? 'burning ' : (bits & StateBit.Poisoned) ? 'poisoned '
    : (bits & StateBit.Shocked) ? 'shocked ' : (bits & StateBit.Chilled) ? 'chilled ' : '';
  return `the ${adj}${v}`;
}

const LAUNCHERS = new Set(['ordnance', 'drones', 'blade', 'laser', 'gravitics', 'ballistics', 'primary', 'ability', 'link', 'chassis', 'infuse', 'fusion']);

/** Event types whose src IS the thing triggered (a Fusion, Linkage, Anomaly...): "which triggered the X". */
function isTrigger(t: Ev): boolean {
  return t === Ev.Fusion || t === Ev.Triad || t === Ev.Linkage || t === Ev.Infusion || t === Ev.Anomaly;
}

function clause(e: SimEvent): { verb: Verb; obj: string; launch?: boolean } {
  const c = e.c ?? 0;
  switch (e.type) {
    case Ev.Hit: return { verb: HIT_VERBS[e.src] ?? ['hit', 'hit'], obj: objectFor(c) };
    case Ev.Kill: return { verb: ['killed', 'kill'], obj: killObject(e) };
    case Ev.StatusApply: return { verb: STATUS_VERBS[c & 0xff] ?? ['afflicted', 'afflict'], obj: objectFor(c >> 8) };
    case Ev.StatusTick: return { verb: ['wore down', 'wear down'], obj: objectFor(c >> 8) };
    case Ev.Explosion: return { verb: ['detonated', 'detonate'], obj: '' };
    case Ev.Spawn:
      if (LAUNCHERS.has(e.src.split('.')[0])) return { verb: ['launched', 'launch'], obj: '', launch: true };
      return { verb: ['spawned', 'spawn'], obj: `a ${nounFor(e.src)}` };
    case Ev.Fusion: case Ev.Triad: case Ev.Linkage: case Ev.Infusion: case Ev.Anomaly:
      return { verb: ['triggered', 'trigger'], obj: nounFor(e.src) };
    case Ev.Cast: return { verb: ['fired', 'fire'], obj: '' };
    case Ev.TowerHit: return { verb: ['hit', 'hit'], obj: 'the tower' };
    case Ev.CoreDrop: return { verb: ['dropped', 'drop'], obj: 'a Core' };
    // Active edge: "The gun killed the Brute, which dropped a salvage crate, which paid 120 Scrap."
    case Ev.Assist: case Ev.Overcharge: return { verb: ['fired', 'fire'], obj: '' };
    case Ev.SalvageDrop: return { verb: ['dropped', 'drop'], obj: 'a salvage crate' };
    case Ev.SalvageCollect: return { verb: ['paid', 'pay'], obj: `${Math.round(e.a)} Scrap` };
    case Ev.BarrierBreak: return { verb: ['broke', 'break'], obj: 'the barrier' };
    case Ev.BossCounter: case Ev.CounterScored: return { verb: ['countered', 'counter'], obj: 'the boss' };
    // Anti-stall (run/stall.ts): "The wave stalled for 10 s, so the stragglers rushed the tower."
    case Ev.Rush: return { verb: ['sent', 'send'], obj: 'the stragglers rushing at the tower' };
    default: return { verb: ['triggered', 'trigger'], obj: '' };
  }
}

/**
 * "The drone shocked the frozen enemy, which caused the lightning to jump to the enemy, ..., which killed the elite."
 * Hit events immediately followed by a same-src Kill of the same enemy are folded into the Kill.
 * A triggered Fusion / Linkage / Infusion / Anomaly reads "which triggered the loaded dice" (its src is the
 * thing triggered, so "caused the loaded dice to trigger loaded dice" never appears), and consecutive
 * identical clauses (repeated links such as DoT ticks or re-triggers) are collapsed into one.
 */
export function chainSentence(chain: readonly SimEvent[]): string {
  const items: SimEvent[] = [];
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i], n = chain[i + 1];
    if (e.type === Ev.Hit && n && n.type === Ev.Kill && n.cause === e.id && n.src === e.src) continue;
    if (e.type === Ev.WaveStart && n && n.type === Ev.Rush) continue;   // the Rush clause names the wave itself
    items.push(e);
  }
  if (items.length === 0) return '';
  const parts: string[] = [];
  let prevNoun = '';
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    const noun = nounFor(e.src);
    const { verb, obj, launch } = clause(e);
    const tail = obj ? ` ${obj}` : '';
    let part: string;
    if (launch) part = i === 0 ? `The ${noun} launched` : `which launched the ${noun}`;
    else if (isTrigger(e.type)) part = i === 0 ? `The ${noun} triggered` : `which triggered the ${noun}`;
    else if (e.type === Ev.SalvageDrop) part = i === 0 ? 'A salvage crate dropped' : 'which dropped a salvage crate';   // Active edge
    else if (e.type === Ev.Rush) part = `${i === 0 ? 'The' : 'which meant the'} wave made no progress for ${Math.round(e.b)} s, so the stragglers rushed the tower`;   // anti-stall
    else if (i === 0) part = `The ${noun} ${verb[0]}${tail}`;
    else if (noun === prevNoun) part = `which ${verb[0]}${tail}`;
    else part = `which caused the ${noun} to ${verb[1]}${tail}`;
    if (parts.length === 0 || parts[parts.length - 1] !== part) parts.push(part);
    prevNoun = noun;
  }
  return parts.join(', ') + '.';
}
