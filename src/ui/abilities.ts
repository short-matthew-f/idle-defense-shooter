/**
 * Ability bar: slotted tactical abilities with CE cost, cooldown sweep and ready state.
 * Tap arms a targeted ability (then tap the field); self abilities cast at once. Long-press (or
 * right-click) opens the slot picker. Keys 1–4 arm (handled by GameUi → press()).
 */
import '../styles/abilities.css';
import type { AbilityId } from '@sim/core/ids';
import type { UiState } from '@sim/core/types';
import { button, h, longPress, show, text, styleVar, attr } from './dom';
import { abilityIcon, icon } from './icons';
import { ABILITIES, ABILITY_BY_ID } from './content';
import { AbilityArming, type ArmResult } from './arming';
import { openModal } from './modal';
import type { UiCtx } from './ctx';
import { bossForWave } from '@sim/data/bosses';
import { equipTarget, preBossInfo, preBossKey, tellDecision, type PreBossInfo } from './tells';
import { QuickBuyChip } from './starter';

/** How long the replace question and the Undo stay up (ms). */
const CONFIRM_MS = 10000;
const UNDO_MS = 5000;
const act = (b: HTMLButtonElement, name: string): HTMLButtonElement => { b.dataset.act = name; return b; };
const MIN_ABILITY_COST = Math.min(...ABILITIES.map((a) => a.cost));

interface Slot { el: HTMLButtonElement; ico: HTMLSpanElement; cost: HTMLSpanElement; key: HTMLSpanElement; ability: AbilityId | null | undefined }

/** Reachability: is Autocast on for `id` (meta.settings.autocastOff is a bitmask over the ABILITIES data order)? */
export function autocastOn(mask: number, id: AbilityId): boolean {
  const k = ABILITIES.findIndex((a) => a.id === id);
  return k < 0 || (mask & (1 << k)) === 0;
}
/** The autocastOff mask with `id` switched on or off. */
export function setAutocast(mask: number, id: AbilityId, on: boolean): number {
  const k = ABILITIES.findIndex((a) => a.id === id);
  if (k < 0) return mask;
  return on ? mask & ~(1 << k) : mask | (1 << k);
}

/** Remaining cooldown as a 0..1 fraction. UiState does not document the unit: seconds, or ticks if larger than the whole cooldown. */
export function cooldownFraction(remaining: number, total: number): number {
  if (!(remaining > 0) || !(total > 0)) return 0;
  const secs = remaining > total + 0.5 ? remaining / 60 : remaining;
  return Math.max(0, Math.min(1, secs / total));
}

export class AbilityBar {
  readonly el: HTMLElement;
  readonly arming = new AbilityArming();
  readonly row = h('div', { class: 'ability-row', attrs: { role: 'toolbar', 'aria-label': 'Tactical abilities' } });
  /** The armed hint ("… armed: tap the field" + Cancel); the overlay lanes place it on a landscape phone (lanes.ts). */
  readonly hint = h('div', { class: 'arm-hint', attrs: { role: 'status' } });
  private readonly hintText = h('span');
  /** Phase 2: the dock's quick-buy chip (starter.ts), left of the slot row; it keeps a buy on Battle after stage 4. */
  readonly quick: QuickBuyChip;
  private slots: Slot[] = [];
  private slotKey = '';
  /** Usable slot count last seen (-1 before the first UiState): a rise toasts "new ability slot". */
  private usable = -1;

  /** Under the boss tell: "Equip X in slot N (replaces Y)?" Equip / Cancel, then Undo for UNDO_MS. */
  readonly tellPanel = h('div', { class: 'tell-confirm', attrs: { role: 'group', 'aria-label': 'Equip the counter ability' } });
  /** On Battle between waves before a boss: the counter is not slotted. Dismissible; never equips by itself. */
  readonly preBoss = h('div', { class: 'preboss-card', attrs: { role: 'group', 'aria-label': 'Next boss' } });
  private preBossHandled: string | null = null;
  private preBossShown: PreBossInfo | null = null;
  private panelTimer = 0;

  constructor(private readonly ctx: UiCtx) {
    this.tellPanel.hidden = true;
    this.preBoss.hidden = true;
    this.hint.append(this.hintText, button('Cancel', () => this.cancel(), { class: 'btn small' }));
    this.hint.hidden = true;
    this.quick = new QuickBuyChip(ctx);
    this.el = h('div', { class: 'abilities' }, this.hint, this.row, this.quick.el);
  }

  private build(ui: UiState): void {
    this.slots = ui.build.abilities.map((_, i) => {
      const ico = h('span', { class: 'ab-ico' });
      const cost = h('span', { class: 'ab-cost' });
      const key = h('span', { class: 'ab-key', text: String(i + 1) });
      const el = button([ico, cost, key], () => { if (!lp.consumed()) this.press(i); }, { class: 'btn ability' });
      const lp = longPress(el, 480, () => this.openPicker(i));
      el.dataset.hint = `ability-${i}`;   // pointer hints (hints.ts)
      return { el, ico, cost, key, ability: undefined };
    });
    this.row.replaceChildren(...this.slots.map((s) => s.el));
    this.row.dataset.n = String(this.slots.length);
    const usable = ui.abilitySlots ?? ui.build.abilities.length;
    this.slots.forEach((s, i) => s.el.classList.toggle('inactive', i >= usable));
  }

  update(ui: UiState): void {
    const usable = ui.abilitySlots ?? ui.build.abilities.length;
    const key = `${ui.build.abilities.length}|${usable}`;
    if (key !== this.slotKey) { this.slotKey = key; this.build(ui); }
    // Reachability: a third / fourth slot appears the moment it is earned; say so once
    if (this.usable >= 0 && usable > this.usable) this.ctx.toast(`New ability slot ${usable}: tap it to choose an ability`, 'good');
    this.usable = usable;
    this.syncPreBoss(ui);
    this.quick.update(ui, this.ctx.features());
    this.el.classList.toggle('qb-on', !this.quick.el.hidden);
    if (this.arming.sync(ui.build.abilities)) this.renderArmed();
    const info = new Map(ui.abilities.map((a) => [a.id, a]));
    ui.build.abilities.forEach((id, i) => {
      const s = this.slots[i];
      if (!s) return;
      if (s.ability !== id) {
        s.ability = id;
        s.ico.replaceChildren(id ? abilityIcon(id, 'ico') : icon('plus', 'ico'));
        const def = id ? ABILITY_BY_ID.get(id) : null;
        const off = i >= (ui.abilitySlots ?? Infinity) ? ' (inactive slot)' : '';
        attr(s.el, 'aria-label', def ? `${def.name} (${i + 1})${off}; hold to change` : `Empty ability slot ${i + 1}: choose an ability`);
        s.el.title = def ? `${def.name}: ${def.desc}\nHold or right-click to change.` : 'Choose an ability';
        s.el.classList.toggle('empty', !id);
      }
      if (!id) {
        text(s.cost, ''); s.el.classList.remove('ready', 'cooling', 'counter');
        // an empty slot pulses once there is enough CE for the cheapest ability: abilities are never explained otherwise
        s.el.classList.toggle('suggest', ui.tower.ce >= MIN_ABILITY_COST);
        return;
      }
      s.el.classList.remove('suggest');
      const a = info.get(id);
      const def = ABILITY_BY_ID.get(id);
      const cost = a?.cost ?? def?.cost ?? 0;
      const cdf = cooldownFraction(a?.cooldown ?? 0, def?.cooldown ?? 0);
      const ready = !!a?.ready && cdf === 0;
      text(s.cost, `${Math.round(cost)}`);
      styleVar(s.el, '--cd', cdf.toFixed(3));
      styleVar(s.el, '--ce', String(Math.max(0, Math.min(1, ui.tower.ce / Math.max(1, cost)))));
      s.el.classList.toggle('ready', ready);
      s.el.classList.toggle('cooling', cdf > 0);
      s.el.classList.toggle('counter', ui.wave.tellActive === id);
    });
  }

  /**
   * Progressive reveal: the slot buttons show from stage 4 (progression.ts 'abilities'). Hidden, the boss-tell banner
   * still casts through press() and the armed hint still shows, so a Counter works before the bar appears.
   */
  setVisible(on: boolean): void { show(this.row, on); }

  /** Keyboard / tap on slot i. */
  press(i: number): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const id = ui.build.abilities[i];
    if (id === undefined) return;
    if (id === null) { this.openPicker(i); return; }
    const a = ui.abilities.find((x) => x.id === id);
    const def = ABILITY_BY_ID.get(id);
    const cdf = cooldownFraction(a?.cooldown ?? 0, def?.cooldown ?? 0);
    const r = this.arming.press(i, { ability: id, ready: !!a?.ready && cdf === 0, targeted: def?.targeted ?? 'point' });
    this.handle(r);
    if (r.kind === 'none' && r.reason === 'not_ready') {
      const s = this.slots[i];
      s?.el.classList.remove('nope'); void s?.el.offsetWidth; s?.el.classList.add('nope');
      if (cdf === 0) this.ctx.toast(`${def?.name ?? id} needs ${Math.round(a?.cost ?? def?.cost ?? 0)} CE`, 'warn');
    }
  }

  /** Field tap → cast (armed) or designate (idle). Returns true when it produced a command. */
  tapField(x: number, y: number, enemy: { x: number; y: number } | null): boolean {
    const r = this.arming.tapField(x, y, enemy);
    this.handle(r);
    return r.kind === 'command';
  }

  cancel(): void { this.arming.cancel(); this.renderArmed(); }

  /** Put `ability` in the first empty slot (or slot 1) with no question asked (the picker-free path; callers decide first). */
  equip(ability: AbilityId): void {
    const ui = this.ctx.state();
    if (!ui || !ui.build.abilities.length) return;
    const { slot } = equipTarget({ slots: ui.build.abilities, usable: ui.abilitySlots });
    this.ctx.host.send({ type: 'set_ability_slot', slot, ability });
    this.ctx.toast(`${ABILITY_BY_ID.get(ability)?.name ?? ability} equipped in slot ${slot + 1}`, 'good');
  }

  /**
   * A tap on the boss-tell banner (tells.ts rules): cast when slotted, equip into an empty slot, else ask before replacing.
   * Before the abilities reveal the banner has no action, so this is not reached.
   */
  tellTap(ability: AbilityId): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const view = { slots: ui.build.abilities, usable: ui.abilitySlots };
    const d = tellDecision({ ...view, revealed: this.ctx.features().abilities, counter: ability });
    if (d === 'info') return;
    if (d === 'cast') { const i = this.slotOf(ability); if (i >= 0) this.press(i); return; }
    if (d === 'equip-empty') { this.equip(ability); return; }
    const t = equipTarget(view);
    this.confirmReplace(ability, t.slot, t.replaces);
  }

  /** The replace question (and, once answered, the Undo) in `panel`; closes itself after `ms`. */
  private confirmReplace(ability: AbilityId, slot: number, replaces: AbilityId | null, panel: HTMLElement = this.tellPanel, after?: () => void): void {
    const name = ABILITY_BY_ID.get(ability)?.name ?? ability;
    const old = replaces ? ABILITY_BY_ID.get(replaces)?.name ?? replaces : null;
    clearTimeout(this.panelTimer);
    const close = (): void => { clearTimeout(this.panelTimer); panel.hidden = true; panel.replaceChildren(); };
    const equip = act(button('Equip', () => {
      this.ctx.host.send({ type: 'set_ability_slot', slot, ability });
      this.ctx.toast(`${name} equipped in slot ${slot + 1}`, 'good');
      after?.();
      if (!replaces) { close(); return; }
      panel.replaceChildren(h('span', { class: 'tc-text', text: `${name} equipped (slot ${slot + 1})` }),
        button('Undo', () => { this.ctx.host.send({ type: 'set_ability_slot', slot, ability: replaces }); this.ctx.toast(`${old} restored in slot ${slot + 1}`, 'info'); close(); }, { class: 'btn small' }));
      this.panelTimer = window.setTimeout(close, UNDO_MS);
    }, { class: 'btn primary small' }), 'equip');
    panel.replaceChildren(
      h('span', { class: 'tc-text', text: `Equip ${name} in slot ${slot + 1}${old ? ` (replaces ${old})` : ''}?` }),
      equip, act(button('Cancel', close, { class: 'btn small' }), 'cancel'));
    panel.hidden = false;
    this.panelTimer = window.setTimeout(close, CONFIRM_MS);
  }

  /** Show / hide the pre-boss card from the latest state (once per boss wave per attempt). */
  private syncPreBoss(ui: UiState): void {
    const info = this.preBossShown
      ? (ui.run.phase === 'between' && preBossKey(ui.run.attempts, ui.run.wave) === this.preBossHandled ? this.preBossShown : null)
      : preBossInfo({
        slots: ui.build.abilities, usable: ui.abilitySlots, phase: ui.run.phase, wave: ui.run.wave, attempts: ui.run.attempts,
        revealed: this.ctx.features().abilities, bossFor: bossForWave, handled: this.preBossHandled,
      });
    if (info === this.preBossShown) return;
    this.preBossShown = info;
    if (!info) { this.preBoss.hidden = true; this.preBoss.replaceChildren(); return; }
    this.preBossHandled = preBossKey(ui.run.attempts, ui.run.wave);
    const name = ABILITY_BY_ID.get(info.ability)?.name ?? info.ability;
    const old = info.replaces ? ABILITY_BY_ID.get(info.replaces)?.name ?? info.replaces : null;
    const dismiss = (): void => { this.preBossShown = null; this.preBoss.hidden = true; this.preBoss.replaceChildren(); };
    const eq = act(button(`Equip in slot ${info.slot + 1}${old ? ` (replaces ${old})` : ''}`, () => {
      this.ctx.host.send({ type: 'set_ability_slot', slot: info.slot, ability: info.ability });
      this.ctx.toast(`${name} equipped in slot ${info.slot + 1}`, 'good');
      dismiss();
    }, { class: 'btn primary small' }), 'equip');
    this.preBoss.replaceChildren(
      h('span', { class: 'pb-text', text: `Next: ${info.bossName}. ${info.tellName}: countered by ${name}.` }),
      h('span', { class: 'pb-btns' }, eq, act(button('Not now', dismiss, { class: 'btn small' }), 'dismiss')));
    this.preBoss.hidden = false;
  }

  /** Slot index holding `ability`, or -1. */
  slotOf(ability: AbilityId): number { return this.ctx.state()?.build.abilities.indexOf(ability) ?? -1; }

  private handle(r: ArmResult): void {
    if (r.kind === 'command') this.ctx.host.send(r.cmd);
    this.renderArmed();
  }

  private renderArmed(): void {
    const armed = this.arming.armed;
    this.slots.forEach((s, i) => { s.el.classList.toggle('armed', armed && i === this.arming.slot); attr(s.el, 'aria-pressed', armed && i === this.arming.slot ? 'true' : 'false'); });
    show(this.hint, armed);
    document.body.classList.toggle('arming', armed);
    if (armed && this.arming.ability) {
      const def = ABILITY_BY_ID.get(this.arming.ability);
      text(this.hintText, def?.targeted === 'enemy' ? `${def.name} armed: tap an enemy` : `${def?.name ?? 'Ability'} armed: tap the field to cast`);
    }
  }

  openPicker(slot: number): void {
    const ui = this.ctx.state();
    if (!ui) return;
    const cur = ui.build.abilities[slot];
    const list = h('div', { class: 'ab-picker' });
    const m = openModal({ title: `Ability slot ${slot + 1}`, body: list, className: 'ab-picker-modal' });
    for (const a of ABILITIES) {
      const where = ui.build.abilities.indexOf(a.id);
      const b = button([
        abilityIcon(a.id, 'ico big'),
        h('span', { class: 'abp-main' },
          h('span', { class: 'abp-name' }, a.name, h('span', { class: 'abp-cost', text: `${a.cost} CE` })),
          h('span', { class: 'abp-desc', text: a.desc }),
          h('span', { class: 'abp-meta', text: `${a.targeted === 'self' ? 'Instant, around the tower' : a.targeted === 'enemy' ? 'Tap an enemy' : 'Tap a point'} · ${a.cooldown}s cooldown${where >= 0 ? ` · in slot ${where + 1}` : ''}` })),
      ], () => { this.ctx.host.send({ type: 'set_ability_slot', slot, ability: a.id }); m.close(); }, { class: `btn abp-item${a.id === cur ? ' current' : ''}` });
      list.appendChild(b);
    }
    if (cur) list.appendChild(button('Empty this slot', () => { this.ctx.host.send({ type: 'set_ability_slot', slot, ability: null }); m.close(); }, { class: 'btn ghost' }));
    list.appendChild(h('p', { class: 'dim small', text: `${ui.build.abilities.length} slots: a third opens at Prestige III, a fourth from the Command Doctrine capstone.` }));
  }
}
