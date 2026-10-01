/**
 * HUD: the two-row top bar (wave · Sector or boss, Scrap/Cores with rate, pause; HP with shield and
 * barrier strips, CE; checkpoint-cycle bar), the Battle control chips (Push/Patrol, speed, restart),
 * the boss bar (phase marks, tell indicator with a shrinking window, weak-point flag) and the status
 * strip shown on the other screens.
 */
import '../styles/hud.css';
import type { AbilityId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { Bar, button, h, show, text, attr, styleVar } from './dom';
import { abilityIcon, icon } from './icons';
import { fmtNum, fmtRate } from './format';
import { ABILITY_BY_ID, BOSS_BY_ID, sectorName } from './content';
import { confirmDialog } from './modal';
import { setPref } from './prefs';
import { cycleBar } from './shell-logic';
import { muteChip } from '../audio/ui';
import type { UiCtx } from './ctx';
import type { Features } from './progression';

const SPEEDS = [1, 2, 4, 8] as const;

/** Scrap income per simulated second over a sliding window (spending does not count). */
export class RateMeter {
  private samples: { t: number; g: number }[] = [];
  private gained = 0;
  private last: number | null = null;
  constructor(private readonly window = 10) {}
  push(t: number, value: number): number {
    if (this.last !== null && value > this.last) this.gained += value - this.last;
    this.last = value;
    const s = this.samples;
    if (s.length && t < s[s.length - 1].t) { s.length = 0; this.gained = 0; }   // Prestige / reset
    s.push({ t, g: this.gained });
    while (s.length > 2 && s[1].t <= t - this.window) s.shift();
    const a = s[0], dt = t - a.t;
    return dt > 0.5 ? (this.gained - a.g) / dt : 0;
  }
}

/** The speeds a chip tap cycles through (never above what this wave allows). */
export function speedCycle(current: number, allowed: number): 1 | 2 | 4 | 8 {
  const opts = SPEEDS.filter((s) => s <= Math.max(1, allowed));
  const i = opts.indexOf(current as 1 | 2 | 4 | 8);
  return opts[(i + 1) % opts.length] ?? 1;
}

/**
 * Top bar: two compact rows plus a 3 px checkpoint-cycle bar.
 *   row 1: "Wave 13 · The Outskirts" (the boss name during a boss wave) · Scrap + rate · Cores · pause
 *   row 2: HP (shield and barrier as thin strips on the same bar) · CE (ability cost marks)
 *   cycle: waves checkpoint+1 … +5 with the wave boundaries as ticks, the boss tick last
 * The Battle controls (Push / Patrol, speed, restart, mute) are 36 px chips over the arena (`controls`).
 */
export class Hud {
  readonly el: HTMLElement;
  /** Push / Patrol, speed (when > ×1 is allowed), restart, mute (src/audio/ui.ts): chips over the top-right of the arena. */
  readonly controls: HTMLElement;
  private readonly waveNum = h('span', { class: 'wave-num' });
  private readonly waveSub = h('span', { class: 'wave-sub' });
  private readonly scrap = h('span', { class: 'res-val' });
  private readonly scrapRate = h('span', { class: 'res-rate' });
  private readonly cores = h('span', { class: 'res-val' });
  private readonly hp = new Bar('hp', 'Tower health');
  private readonly shieldStrip = h('i', { class: 'strip shield' });
  private readonly barrierStrip = h('i', { class: 'strip barrier' });
  private readonly shieldLbl = h('span', { class: 'bar-aux shield' });
  private readonly ce = new Bar('ce', 'Command Energy');
  private readonly ceMarks = h('div', { class: 'ce-marks' });
  private readonly cycle = h('div', { class: 'cycle', attrs: { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100' } });
  private readonly cycleFill = h('div', { class: 'cycle-fill' });
  private readonly cycleTicks: HTMLElement[] = [];
  private readonly modeBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly trialBanner = h('div', { class: 'trial-banner' });
  /** Reachability: "2 designators" hint (Second Opinion / Commander reward) with how many are in use. */
  private readonly desig = h('span', { class: 'desig-chip', attrs: { role: 'status' } });
  private readonly desigText = h('span');
  private readonly desigLabel = h('span', { class: 'desig-label' });
  private readonly trialName = h('span');
  private rate = new RateMeter();
  /** Last measured Scrap income (per second), for ETAs elsewhere in the UI. */
  lastRate = 0;
  private ceKey = '';
  readonly bossBar: BossBar;
  /** Tapping the boss tell (arm / equip its Counter); GameUi wires it to the ability bar. */
  onTell: ((tell: AbilityId | 'designate') => void) | null = null;
  /** The Settings chip (before the More tab is revealed); GameUi opens More. */
  onMenu: (() => void) | null = null;
  private readonly restartBtn: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly coresItem: HTMLElement;
  /** Progressive reveal: what this HUD shows (GameUi sets it; everything until then). */
  private feats: Pick<Features, 'runControls' | 'abilities' | 'inspector' | 'moreTab' | 'cores' | 'boons'> | null = null;

  constructor(ctx: UiCtx) {
    this.modeBtn = button('Push', () => {
      const s = ctx.state(); if (!s) return;
      ctx.host.send({ type: 'set_mode', mode: s.run.mode === 'push' ? 'patrol' : 'push' });
    }, { class: 'btn ctl mode-btn', title: 'Push: advance and fight bosses. Patrol: loop the four waves after the checkpoint. (P)' });
    this.speedBtn = button('×1', () => {
      const s = ctx.state(); if (!s) return;
      const next = speedCycle(s.run.speedMultiplier, s.speedAllowed ?? 1);
      if (next !== s.run.speedMultiplier) ctx.host.send({ type: 'set_speed', speed: next });
    }, { class: 'btn ctl speed-btn', title: 'Simulation speed: tap to cycle (solved waves only)' });
    const restart = this.restartBtn = button(icon('restart'), async () => {
      const s = ctx.state();
      const ok = await confirmDialog('Restart from checkpoint?', `The current attempt ends and you restart at wave ${(s?.run.checkpoint ?? 0) + 1}. Scrap and upgrades are kept.`, 'Restart');
      if (ok) ctx.host.send({ type: 'restart_checkpoint' });
    }, { class: 'btn ctl icon', label: 'Restart from checkpoint' });
    this.pauseBtn = button(icon('pause'), () => ctx.open('inspector'), { class: 'btn ctl icon pause-btn', label: 'Pause and open the Kill-Chain Inspector (Space)' });

    this.ce.el.appendChild(this.ceMarks);
    this.hp.el.append(this.barrierStrip, this.shieldStrip, this.shieldLbl);
    this.cycle.appendChild(this.cycleFill);
    for (let i = 0; i < 5; i++) { const t = h('i', { class: 'tick' }); this.cycleTicks.push(t); this.cycle.appendChild(t); }

    const endTrial = button('End', async () => {
      if (await confirmDialog('End this Trial?', 'Your Trial progress is recorded and the main run resumes where you left it.', 'End trial')) {
        ctx.host.send({ type: 'end_trial' });
        setPref('activeTrial', null);
      }
    }, { class: 'btn ctl', label: 'End trial' });
    this.trialBanner.append(icon('trials', 'ico tiny'), this.trialName, endTrial);
    this.trialBanner.hidden = true;

    this.el = h('header', { class: 'topbar', attrs: { 'aria-label': 'Battle status' } },
      h('div', { class: 'tb-row tb-head' },
        h('div', { class: 'wave-line' }, this.waveNum, this.waveSub),
        h('div', { class: 'res' },
          h('div', { class: 'res-item scrap', title: 'Scrap: spend it on upgrades. Banks on every kill and survives death.' }, icon('scrap', 'ico res-ico'), h('span', { class: 'res-stack' }, this.scrap, this.scrapRate)),
          this.coresItem = h('div', { class: 'res-item cores', title: 'Cores: commitment currency (Exotics, Refits, Doctrine changes, rerolls).' }, icon('cores', 'ico res-ico'), this.cores)),
        this.pauseBtn),
      h('div', { class: 'tb-row tb-bars' }, this.hp.el, this.ce.el),
      this.cycle);
    this.desig.append(abilityIcon('designate', 'ico tiny'), this.desigText, this.desigLabel);
    this.desig.hidden = true;
    this.menuBtn = button(icon('settings'), () => this.onMenu?.(), { class: 'btn ctl icon menu-chip', label: 'Settings and help' });
    this.menuBtn.hidden = true;
    this.controls = h('div', { class: 'battle-controls', attrs: { role: 'toolbar', 'aria-label': 'Run controls' } }, this.trialBanner, this.desig, this.modeBtn, this.speedBtn, restart, muteChip(), this.menuBtn);
    this.bossBar = new BossBar((t) => this.onTell?.(t));
  }

  /**
   * Progressive reveal (progression.ts): Push / Patrol and Restart from the first checkpoint, CE with the ability bar,
   * pause (it opens the Inspector) with the Inspector, Cores once they matter; a Settings chip until the More tab shows.
   */
  setFeatures(f: Features): void {
    this.feats = f;
    show(this.restartBtn, f.runControls);
    show(this.ce.el, f.abilities);
    show(this.pauseBtn, f.inspector);
    show(this.menuBtn, !f.moreTab);
  }

  /** Forget income history (offline credit, Prestige) so the rate shows live income only. */
  resetRate(): void { this.rate = new RateMeter(); this.lastRate = 0; }

  setPaused(p: boolean): void {
    this.pauseBtn.replaceChildren(icon(p ? 'play' : 'pause'));
    this.pauseBtn.setAttribute('aria-label', p ? 'Resume (Space)' : 'Pause and open the Kill-Chain Inspector (Space)');
  }

  setTrial(name: string | null): void {
    show(this.trialBanner, name !== null);
    if (name) text(this.trialName, `Trial: ${name}`);
  }

  update(ui: UiState): void {
    const r = ui.run, w = ui.wave, t = ui.tower;
    text(this.waveNum, `Wave ${r.wave}`);
    const bossName = w.isBoss && w.bossId ? (BOSS_BY_ID.get(w.bossId)?.name ?? w.bossId) : '';
    // the boss name replaces the Sector during a boss wave (in full: the Sector is the part that gives way)
    text(this.waveSub, bossName || (r.mode === 'patrol' ? `Patrol · ${sectorName(w.sector)}` : sectorName(w.sector)));
    this.el.classList.toggle('boss-wave', w.isBoss);

    text(this.scrap, fmtNum(r.scrap));
    const rate = this.rate.push(r.playSeconds, r.scrap);
    this.lastRate = rate;
    text(this.scrapRate, rate > 0 ? fmtRate(rate) : '');
    text(this.cores, fmtNum(r.cores));

    const cyc = cycleBar(r.wave, r.checkpoint, w.progress);
    styleVar(this.cycleFill, '--f', cyc.frac.toFixed(4));
    cyc.ticks.forEach((tk, i) => {
      const el = this.cycleTicks[i];
      styleVar(el, '--at', String(tk.at));
      el.classList.toggle('boss', tk.boss);
      el.classList.toggle('done', tk.done);
      el.classList.toggle('cur', tk.current);
    });
    attr(this.cycle, 'aria-valuenow', String(Math.round(cyc.frac * 100)));
    attr(this.cycle, 'aria-label', `Wave ${r.wave}, ${Math.round(w.progress * 100)}% cleared. Checkpoint ${r.checkpoint}; boss at wave ${Math.ceil((r.checkpoint + 1) / 5) * 5}. ${w.enemiesAlive} enemies alive.`);

    this.hp.set(t.maxHp > 0 ? t.hp / t.maxHp : 0, `HP ${fmtNum(t.hp)}/${fmtNum(t.maxHp)}`, t.maxHp > 0 ? t.tempHp / t.maxHp : 0);
    this.hp.el.classList.toggle('low', t.maxHp > 0 && t.hp / t.maxHp < 0.3);
    const sh = t.maxShield > 0, br = t.maxBarrier > 0;
    show(this.shieldStrip, sh);
    show(this.barrierStrip, br);
    if (sh) styleVar(this.shieldStrip, '--f', (t.shield / t.maxShield).toFixed(3));
    if (br) styleVar(this.barrierStrip, '--f', (t.barrier / t.maxBarrier).toFixed(3));
    // one extra number on the bar: the shield (blue) if any, else temporary HP (white)
    const aux = sh && t.shield > 0 ? `+${fmtNum(t.shield)}` : t.tempHp > 0 ? `+${fmtNum(t.tempHp)}` : '';
    text(this.shieldLbl, aux);
    this.shieldLbl.classList.toggle('temp', !(sh && t.shield > 0));
    this.hp.el.classList.toggle('has-aux', aux !== '');
    attr(this.hp.el, 'aria-label', `Tower health${t.tempHp > 0 ? `, ${fmtNum(t.tempHp)} temporary` : ''}${sh ? `, shield ${fmtNum(t.shield)} of ${fmtNum(t.maxShield)}` : ''}${br ? `, barrier ${fmtNum(t.barrier)}` : ''}`);
    this.ce.set(t.ceCap > 0 ? t.ce / t.ceCap : 0, `CE ${Math.floor(t.ce)}/${Math.floor(t.ceCap)}`);
    const ceKey = ui.abilities.map((a) => Math.round(a.cost)).join(',') + '/' + t.ceCap;
    if (ceKey !== this.ceKey) {
      this.ceKey = ceKey;
      this.ceMarks.replaceChildren(...ui.abilities.filter((a) => a.cost < t.ceCap).map((a) => h('i', { style: { left: `${(a.cost / t.ceCap) * 100}%` }, title: `${ABILITY_BY_ID.get(a.id)?.name}: ${Math.round(a.cost)} CE` })));
    }

    const f = this.feats;
    show(this.coresItem, !f || f.cores || f.boons || (r.cores > 0 && f.runControls));   // Cores show once there are any (first boss) or they buy something
    show(this.modeBtn, !f || f.runControls || r.mode === 'patrol');
    text(this.modeBtn, r.mode === 'push' ? 'Push' : 'Patrol');
    attr(this.modeBtn, 'aria-pressed', r.mode === 'patrol' ? 'true' : 'false');
    attr(this.modeBtn, 'aria-label', r.mode === 'push' ? 'Mode: Push. Tap for Patrol (P)' : 'Mode: Patrol. Tap for Push (P)');
    this.modeBtn.classList.toggle('patrol', r.mode === 'patrol');
    const maxSpeed = ui.speedAllowed ?? 1;
    // speed only matters once a speed above ×1 is allowed (Accelerated Clearing / Speed Controls)
    show(this.speedBtn, maxSpeed > 1 || r.speedMultiplier > 1);
    text(this.speedBtn, `×${r.speedMultiplier}`);
    this.speedBtn.classList.toggle('fast', r.speedMultiplier > 1);
    attr(this.speedBtn, 'aria-label', `Speed ×${r.speedMultiplier}; tap for ×${speedCycle(r.speedMultiplier, maxSpeed)}`);
    this.bossBar.update(ui);
    const d = ui.designators;
    show(this.desig, !!d && d.slots >= 2);
    if (d && d.slots >= 2) {
      text(this.desigText, d.live === 0 ? String(d.slots) : `${d.live}/${d.slots}`);
      text(this.desigLabel, d.live === 0 ? 'designators' : 'designated');   // hidden on a landscape phone (narrow control column)
      attr(this.desig, 'aria-label', `2 designators, ${d.live} in use. Tap enemies to designate them; tap a designated enemy to clear it.`);
      this.desig.title = '2 designators: tap two enemies; a third tap replaces the older; tap a designated enemy to clear it';
    }
  }
}

/**
 * Slim strip at the top of every non-Battle screen on phones: wave, HP as a tiny bar, Scrap. Tapping
 * it returns to Battle, so a player deep in the shop still sees the tower dying.
 */
export class StatusStrip {
  readonly el: HTMLButtonElement;
  private readonly wave = h('span', { class: 'ss-wave' });
  private readonly boss = icon('skull', 'ico tiny ss-boss');
  private readonly hpFill = h('i', { class: 'ss-hp-fill' });
  private readonly hpText = h('span', { class: 'ss-hp-text' });
  private readonly scrap = h('span', { class: 'ss-scrap' });
  constructor(onTap: () => void) {
    this.el = button([
      h('span', { class: 'ss-wave-wrap' }, this.wave, this.boss),
      h('span', { class: 'ss-hp' }, icon('heart', 'ico tiny'), h('span', { class: 'ss-hp-bar' }, this.hpFill), this.hpText),
      h('span', { class: 'ss-res' }, icon('scrap', 'ico tiny'), this.scrap),
      h('span', { class: 'ss-back' }, h('span', { class: 'ss-back-label', text: 'Battle' }), icon('right', 'ico tiny chev')),
    ], onTap, { class: 'status-strip' });
  }
  update(ui: UiState): void {
    const t = ui.tower;
    const f = t.maxHp > 0 ? t.hp / t.maxHp : 0;
    const dead = ui.run.phase === 'dead';
    text(this.wave, `Wave ${ui.run.wave}`);
    this.boss.style.display = ui.wave.isBoss ? '' : 'none';
    styleVar(this.hpFill, '--f', f.toFixed(3));
    text(this.hpText, dead ? 'Destroyed' : `${Math.round(f * 100)}%`);
    text(this.scrap, fmtNum(ui.run.scrap));
    this.el.classList.toggle('low', f < 0.3 || dead);
    attr(this.el, 'aria-label', `Wave ${ui.run.wave}${ui.wave.isBoss ? ' (boss)' : ''}, tower ${dead ? 'destroyed' : `health ${Math.round(f * 100)}%`}, ${fmtNum(ui.run.scrap)} Scrap. Back to Battle`);
  }
}

export class BossBar {
  readonly el: HTMLElement;
  private readonly name = h('span', { class: 'boss-name' });
  private readonly phase = h('span', { class: 'boss-phase' });
  private readonly bar = new Bar('boss-hp', 'Boss health');
  private readonly marks = h('div', { class: 'boss-marks' });
  private readonly weak = h('span', { class: 'weak-flag', attrs: { 'aria-label': 'Weak point open' } }, icon('target', 'ico tiny'), h('span', { class: 'wf-label', text: 'Weak point' }));
  private readonly tell = h('button', { type: 'button', class: 'tell' });
  private readonly tellIcon = h('span', { class: 'tell-ico' });
  private readonly tellText = h('span', { class: 'tell-text' });
  private readonly tellWin = h('div', { class: 'tell-window' }, h('div', { class: 'tell-fill' }));
  private marksKey = '';
  private tellKey = '';
  private tellMax = 1;

  private tellId: AbilityId | 'designate' | null = null;

  constructor(onTell: (tell: AbilityId | 'designate') => void = () => {}) {
    this.bar.el.appendChild(this.marks);
    this.tell.append(this.tellIcon, this.tellText, this.tellWin);
    this.tell.addEventListener('click', () => { if (this.tellId) onTell(this.tellId); });
    this.el = h('div', { class: 'boss-bar', attrs: { role: 'group', 'aria-label': 'Boss' } },
      // one slim row (name, health with the phase, weak-point flag) and the tell under it: the bar floats over the top of
      // the arena, so it stays low (the overlay lanes keep its column above the tower: lanes.ts)
      h('div', { class: 'boss-head' }, icon('skull', 'ico tiny'), this.name, this.bar.el, this.weak), this.tell);
    this.el.hidden = true;
  }

  update(ui: UiState): void {
    const w = ui.wave;
    const on = w.isBoss && w.bossMaxHp > 0;
    show(this.el, on);
    if (!on) return;
    const def = w.bossId ? BOSS_BY_ID.get(w.bossId) : undefined;
    text(this.name, def?.name ?? 'Boss');
    const phaseName = def?.phases[w.bossPhase]?.name;
    text(this.phase, `Phase ${w.bossPhase + 1}${phaseName ? ` · ${phaseName}` : ''}`);
    this.bar.set(w.bossHp / w.bossMaxHp, `P${w.bossPhase + 1} · ${fmtNum(w.bossHp)} / ${fmtNum(w.bossMaxHp)}`);
    attr(this.bar.el, 'title', `${this.phase.textContent}: ${fmtNum(w.bossHp)} / ${fmtNum(w.bossMaxHp)}`);
    const mk = w.bossPhaseMarks.join(',');
    if (mk !== this.marksKey) {
      this.marksKey = mk;
      this.marks.replaceChildren(...w.bossPhaseMarks.map((f) => h('i', { style: { left: `${f * 100}%` } })));
    }
    show(this.weak, w.weakPointOpen);
    this.el.classList.toggle('weak-open', w.weakPointOpen);

    const tell = w.tellActive;
    this.tellId = tell;
    show(this.tell, tell !== null);
    if (tell !== null) {
      const prompt = tellPrompt(tell, ui);
      const key = `${tell}|${prompt.action}`;
      if (key !== this.tellKey || w.tellTicksLeft > this.tellMax) {
        if (!this.tellKey.startsWith(`${tell}|`) || w.tellTicksLeft > this.tellMax) this.tellMax = Math.max(1, def ? Math.round(def.tell.windowSeconds * 60) : w.tellTicksLeft, w.tellTicksLeft);
        this.tellKey = key;
        this.tellIcon.replaceChildren(abilityIcon(tell, 'ico'));
        text(this.tellText, `${def?.tell.name ?? 'Tell'}: ${prompt.text}`);
        attr(this.tell, 'aria-label', `${def?.tell.name ?? 'Boss tell'}: ${prompt.text}`);
        this.tell.dataset.action = prompt.action;
      }
      styleVar(this.tell, '--win', String(Math.max(0, Math.min(1, w.tellTicksLeft / this.tellMax))));
    } else this.tellKey = '';
  }
}

/**
 * What the boss-tell banner asks for (pure). The Counter ability may not be slotted (a new player's
 * slots start empty), may lack CE, or may be ready: the banner says which, and tapping it acts.
 */
export function tellPrompt(tell: AbilityId | 'designate', ui: Pick<UiState, 'build' | 'abilities' | 'tower'>): { text: string; action: 'designate' | 'cast' | 'equip' | 'wait' } {
  if (tell === 'designate') return { text: 'tap the weak point to designate it', action: 'designate' };
  const name = ABILITY_BY_ID.get(tell)?.name ?? tell;
  if (!ui.build.abilities.includes(tell)) return { text: `${name} counters it. Tap to equip it`, action: 'equip' };
  const a = ui.abilities.find((x) => x.id === tell);
  if (a && a.ready) return { text: `tap to counter with ${name}`, action: 'cast' };
  const cost = Math.round(a?.cost ?? ABILITY_BY_ID.get(tell)?.cost ?? 0);
  return { text: ui.tower.ce < cost ? `counter with ${name} (needs ${cost} CE)` : `counter with ${name} (cooling down)`, action: 'wait' };
}
