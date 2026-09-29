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

const MIN_ABILITY_COST = Math.min(...ABILITIES.map((a) => a.cost));

interface Slot { el: HTMLButtonElement; ico: HTMLSpanElement; cost: HTMLSpanElement; key: HTMLSpanElement; ability: AbilityId | null | undefined }

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
  private readonly hint = h('div', { class: 'arm-hint', attrs: { role: 'status' } });
  private readonly hintText = h('span');
  private slots: Slot[] = [];
  private slotKey = '';

  constructor(private readonly ctx: UiCtx) {
    this.hint.append(this.hintText, button('Cancel', () => this.cancel(), { class: 'btn small' }));
    this.hint.hidden = true;
    this.el = h('div', { class: 'abilities' }, this.hint, this.row);
  }

  private build(ui: UiState): void {
    this.slots = ui.build.abilities.map((_, i) => {
      const ico = h('span', { class: 'ab-ico' });
      const cost = h('span', { class: 'ab-cost' });
      const key = h('span', { class: 'ab-key', text: String(i + 1) });
      const el = button([ico, cost, key], () => { if (!lp.consumed()) this.press(i); }, { class: 'btn ability' });
      const lp = longPress(el, 480, () => this.openPicker(i));
      return { el, ico, cost, key, ability: undefined };
    });
    this.row.replaceChildren(...this.slots.map((s) => s.el));
  }

  update(ui: UiState): void {
    const key = String(ui.build.abilities.length);
    if (key !== this.slotKey) { this.slotKey = key; this.build(ui); }
    if (this.arming.sync(ui.build.abilities)) this.renderArmed();
    const info = new Map(ui.abilities.map((a) => [a.id, a]));
    ui.build.abilities.forEach((id, i) => {
      const s = this.slots[i];
      if (!s) return;
      if (s.ability !== id) {
        s.ability = id;
        s.ico.replaceChildren(id ? abilityIcon(id, 'ico') : icon('plus', 'ico'));
        const def = id ? ABILITY_BY_ID.get(id) : null;
        attr(s.el, 'aria-label', def ? `${def.name} (${i + 1}); hold to change` : `Empty ability slot ${i + 1}: choose an ability`);
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

  /** Put `ability` in the first empty slot (or slot 1) — the boss-tell banner's "tap to equip". */
  equip(ability: AbilityId): void {
    const ui = this.ctx.state();
    if (!ui || !ui.build.abilities.length) return;
    let slot = ui.build.abilities.indexOf(null);
    if (slot < 0) slot = 0;
    this.ctx.host.send({ type: 'set_ability_slot', slot, ability });
    this.ctx.toast(`${ABILITY_BY_ID.get(ability)?.name ?? ability} equipped in slot ${slot + 1}`, 'good');
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
