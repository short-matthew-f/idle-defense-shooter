/**
 * HUD: top bar (wave, Sector, boss, progress + checkpoint pips, enemies alive, tower bars, CE,
 * Scrap/Cores with rate, Push/Patrol, speed, restart, pause/Inspector, Forecast, menu) and the
 * boss bar (phase marks, tell indicator with a shrinking window, weak-point flag).
 */
import '../styles/hud.css';
import type { AbilityId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { Bar, button, h, show, text, disable, attr, styleVar } from './dom';
import { abilityIcon, icon } from './icons';
import { fmtNum, fmtRate } from './format';
import { ABILITY_BY_ID, BOSS_BY_ID, sectorName } from './content';
import { confirmDialog } from './modal';
import { setPref } from './prefs';
import type { UiCtx } from './ctx';

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

export class Hud {
  readonly el: HTMLElement;
  private readonly waveNum = h('span', { class: 'wave-num' });
  private readonly sector = h('span', { class: 'wave-sector' });
  private readonly boss = h('span', { class: 'wave-boss' });
  private readonly scrap = h('span', { class: 'res-val' });
  private readonly scrapRate = h('span', { class: 'res-rate' });
  private readonly cores = h('span', { class: 'res-val' });
  private readonly alive = h('span', { class: 'alive-val' });
  private readonly progress = new Bar('progress', 'Wave progress');
  private readonly pips: HTMLSpanElement[] = [];
  private readonly cpLabel = h('span', { class: 'cp-label' });
  private readonly hp = new Bar('hp', 'Tower health');
  private readonly shield = new Bar('shield thin', 'Shield');
  private readonly barrier = new Bar('barrier thin', 'Barrier');
  private readonly ce = new Bar('ce', 'Command Energy');
  private readonly ceMarks = h('div', { class: 'ce-marks' });
  private readonly modeBtn: HTMLButtonElement;
  private readonly speedWrap: HTMLDivElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly forecastBtn: HTMLButtonElement;
  private readonly forecastBadge = h('span', { class: 'badge', text: '!' });
  private readonly pauseBtn: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly trialBanner = h('div', { class: 'trial-banner' });
  private readonly trialName = h('span');
  private rate = new RateMeter();
  /** Last measured Scrap income (per second), for ETAs elsewhere in the UI. */
  lastRate = 0;
  private ceKey = '';
  readonly bossBar: BossBar;
  /** Tapping the boss tell (arm / equip its Counter); GameUi wires it to the ability bar. */
  onTell: ((tell: AbilityId | 'designate') => void) | null = null;

  constructor(private readonly ctx: UiCtx) {
    this.modeBtn = button('Push', () => {
      const s = ctx.state(); if (!s) return;
      ctx.host.send({ type: 'set_mode', mode: s.run.mode === 'push' ? 'patrol' : 'push' });
    }, { class: 'btn mode-btn', title: 'Push: advance and fight bosses. Patrol: loop the four waves after the checkpoint. (P)' });
    this.speedWrap = h('div', { class: 'speed seg', attrs: { role: 'group', 'aria-label': 'Simulation speed' } });
    for (const sp of SPEEDS) {
      const b = button(`×${sp}`, () => this.pickSpeed(sp), { class: 'btn seg-btn', title: sp === 1 ? 'Normal speed' : `×${sp}: solved waves only (Accelerated Clearing runs them automatically; Speed Controls lets you pick)` });
      this.speedBtns.push(b);
      this.speedWrap.appendChild(b);
    }
    const restart = button(icon('restart'), async () => {
      const s = ctx.state();
      const ok = await confirmDialog('Restart from checkpoint?', `The current attempt ends and you restart at wave ${(s?.run.checkpoint ?? 0) + 1}. Scrap and upgrades are kept.`, 'Restart');
      if (ok) ctx.host.send({ type: 'restart_checkpoint' });
    }, { class: 'btn icon-btn', label: 'Restart from checkpoint' });
    this.pauseBtn = button(icon('pause'), () => ctx.open('inspector'), { class: 'btn icon-btn', label: 'Pause and open the Kill-Chain Inspector (Space)' });
    this.forecastBtn = button([icon('forecast'), this.forecastBadge], () => ctx.open('forecast'), { class: 'btn icon-btn forecast-btn', label: 'Prestige Forecast (F)' });
    this.menuBtn = button(icon('menu'), () => ctx.open('menu'), { class: 'btn icon-btn', label: 'Menu' });
    this.menuBtn.setAttribute('aria-haspopup', 'menu');
    this.forecastBadge.hidden = true;

    for (let i = 0; i < 5; i++) this.pips.push(h('span', { class: 'pip' }));
    this.ce.el.appendChild(this.ceMarks);

    const endTrial = button('End trial', async () => {
      if (await confirmDialog('End this Trial?', 'Your Trial progress is recorded and the main run resumes where you left it.', 'End trial')) {
        ctx.host.send({ type: 'end_trial' });
        setPref('activeTrial', null);
      }
    }, { class: 'btn small' });
    this.trialBanner.append(icon('trials'), this.trialName, endTrial);
    this.trialBanner.hidden = true;

    this.el = h('header', { class: 'hud', attrs: { 'aria-label': 'Battle status' } },
      h('div', { class: 'hud-row hud-top' },
        h('div', { class: 'wave-block' }, this.waveNum, h('div', { class: 'wave-meta' }, this.sector, this.boss)),
        h('div', { class: 'res' },
          h('div', { class: 'res-item scrap', title: 'Scrap: spend it on upgrades. Banks on every kill and survives death.' }, icon('scrap', 'ico res-ico'), this.scrap, this.scrapRate),
          h('div', { class: 'res-item cores', title: 'Cores: commitment currency (Exotics, Refits, Doctrine changes, rerolls).' }, icon('cores', 'ico res-ico'), this.cores)),
        this.menuBtn),
      h('div', { class: 'hud-row hud-progress' },
        h('div', { class: 'pips', attrs: { 'aria-hidden': 'true' } }, ...this.pips), this.cpLabel, this.progress.el,
        h('span', { class: 'alive', title: 'Enemies alive' }, icon('enemy', 'ico tiny'), this.alive)),
      h('div', { class: 'hud-row hud-bars' },
        h('div', { class: 'tower-bars' }, this.hp.el, this.shield.el, this.barrier.el),
        this.ce.el),
      h('div', { class: 'hud-row hud-controls' }, this.modeBtn, h('div', { class: 'speed-slot' }, this.speedWrap), restart, this.pauseBtn, this.forecastBtn),
      this.trialBanner);
    this.bossBar = new BossBar((t) => this.onTell?.(t));
    document.addEventListener('pointerdown', (e) => { if (!this.speedWrap.contains(e.target as Node)) this.speedWrap.classList.remove('open'); });
  }

  /** Forget income history (offline credit, Prestige) so the rate shows live income only. */
  resetRate(): void { this.rate = new RateMeter(); this.lastRate = 0; }

  private pickSpeed(sp: 1 | 2 | 4 | 8): void {
    const s = this.ctx.state(); if (!s) return;
    const narrow = window.matchMedia('(max-width: 599px), (max-height: 499px) and (min-width: 600px) and (orientation: landscape)').matches;
    if (narrow && !this.speedWrap.classList.contains('open')) { this.speedWrap.classList.add('open'); return; }
    this.speedWrap.classList.remove('open');
    if (sp !== s.run.speedMultiplier) this.ctx.host.send({ type: 'set_speed', speed: sp });
  }

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
    text(this.sector, sectorName(w.sector));
    const bossName = w.isBoss && w.bossId ? (BOSS_BY_ID.get(w.bossId)?.name ?? w.bossId) : '';
    text(this.boss, bossName ? `Boss: ${bossName}` : r.mode === 'patrol' ? 'Patrol' : '');
    this.el.classList.toggle('boss-wave', w.isBoss);

    text(this.scrap, fmtNum(r.scrap));
    const rate = this.rate.push(r.playSeconds, r.scrap);
    this.lastRate = rate;
    text(this.scrapRate, rate > 0 ? fmtRate(rate) : '');
    text(this.cores, fmtNum(r.cores));

    // checkpoint cycle pips: waves checkpoint+1 … checkpoint+5 (the fifth is the boss)
    const cp = r.checkpoint;
    for (let i = 0; i < 5; i++) {
      const wv = cp + 1 + i, p = this.pips[i];
      p.classList.toggle('done', wv < r.wave);
      p.classList.toggle('cur', wv === r.wave);
      p.classList.toggle('boss', wv % 5 === 0);
      attr(p, 'title', `Wave ${wv}${wv % 5 === 0 ? ' (boss)' : ''}`);
    }
    text(this.cpLabel, `CP ${cp}`);
    this.progress.set(w.progress, `${Math.round(w.progress * 100)}%`);
    text(this.alive, String(w.enemiesAlive));

    this.hp.set(t.maxHp > 0 ? t.hp / t.maxHp : 0, `HP ${fmtNum(t.hp)}/${fmtNum(t.maxHp)}${t.tempHp > 0 ? ` +${fmtNum(t.tempHp)}` : ''}`, t.maxHp > 0 ? t.tempHp / t.maxHp : 0);
    show(this.shield.el, t.maxShield > 0);
    if (t.maxShield > 0) this.shield.set(t.shield / t.maxShield, `Shield ${fmtNum(t.shield)}`);
    show(this.barrier.el, t.maxBarrier > 0);
    if (t.maxBarrier > 0) this.barrier.set(t.barrier / t.maxBarrier, `Barrier ${fmtNum(t.barrier)}`);
    this.ce.set(t.ceCap > 0 ? t.ce / t.ceCap : 0, `CE ${Math.floor(t.ce)}/${Math.floor(t.ceCap)}`);
    const ceKey = ui.abilities.map((a) => Math.round(a.cost)).join(',') + '/' + t.ceCap;
    if (ceKey !== this.ceKey) {
      this.ceKey = ceKey;
      this.ceMarks.replaceChildren(...ui.abilities.filter((a) => a.cost < t.ceCap).map((a) => h('i', { style: { left: `${(a.cost / t.ceCap) * 100}%` }, title: `${ABILITY_BY_ID.get(a.id)?.name}: ${Math.round(a.cost)} CE` })));
    }

    text(this.modeBtn, r.mode === 'push' ? 'Push' : 'Patrol');
    attr(this.modeBtn, 'aria-pressed', r.mode === 'patrol' ? 'true' : 'false');
    this.modeBtn.classList.toggle('patrol', r.mode === 'patrol');
    const maxSpeed = ui.speedAllowed ?? 1;
    SPEEDS.forEach((sp, i) => {
      const b = this.speedBtns[i];
      const active = sp === r.speedMultiplier;
      b.classList.toggle('active', active);
      attr(b, 'aria-pressed', active ? 'true' : 'false');
      disable(b, sp > maxSpeed && !active);
    });
    const rec = !!ui.forecast?.recommended;
    show(this.forecastBadge, rec);
    this.forecastBtn.classList.toggle('alert', rec);
    this.bossBar.update(ui);
  }
}

export class BossBar {
  readonly el: HTMLElement;
  private readonly name = h('span', { class: 'boss-name' });
  private readonly phase = h('span', { class: 'boss-phase' });
  private readonly bar = new Bar('boss-hp', 'Boss health');
  private readonly marks = h('div', { class: 'boss-marks' });
  private readonly weak = h('span', { class: 'weak-flag' }, icon('target', 'ico tiny'), 'Weak point open');
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
      h('div', { class: 'boss-head' }, icon('skull', 'ico tiny'), this.name, this.phase, this.weak), this.bar.el, this.tell);
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
    this.bar.set(w.bossHp / w.bossMaxHp, `${fmtNum(w.bossHp)} / ${fmtNum(w.bossMaxHp)}`);
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
