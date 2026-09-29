/** First-run onboarding: three short dismissible cards; dismissal stored in prefs (localStorage). */
import '../styles/onboard.css';
import { button, h, text } from './dom';
import { icon } from './icons';
import { openModal } from './modal';
import { prefs, setPref } from './prefs';

export const ONBOARD_CARDS: { icon: string; title: string; body: string }[] = [
  { icon: 'shield', title: 'The tower fights alone', body: 'Your tower shoots on its own. Watching the machine work is the game: you design it, it fights.' },
  { icon: 'restart', title: 'Die, keep Scrap, push farther', body: 'When the tower falls you keep your Scrap and upgrades and restart after the last boss you beat. Spend, then push again.' },
  { icon: 'target', title: 'Command, don\'t aim', body: 'Tap an enemy to designate it: every weapon prefers it. Hold anywhere to steer the main gun. Abilities spend Command Energy.' },
];

export function maybeOnboard(force = false): void {
  if (!force && prefs().onboarded) return;
  let i = 0;
  const ico = h('div', { class: 'ob-ico' });
  const title = h('h3', { class: 'ob-title' });
  const body = h('p', { class: 'ob-body' });
  const dots = h('div', { class: 'ob-dots', attrs: { 'aria-hidden': 'true' } }, ...ONBOARD_CARDS.map(() => h('span')));
  const next = button('Next', () => { if (i < ONBOARD_CARDS.length - 1) { i++; render(); } else done(); }, { class: 'btn primary' });
  const skip = button('Skip', () => done(), { class: 'btn ghost' });
  const render = (): void => {
    const c = ONBOARD_CARDS[i];
    ico.replaceChildren(icon(c.icon, 'ico huge'));
    text(title, c.title);
    text(body, c.body);
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    text(next, i === ONBOARD_CARDS.length - 1 ? 'Start' : 'Next');
  };
  const done = (): void => { setPref('onboarded', true); m.close(); };
  const m = openModal({ title: 'Welcome to Citadel', body: h('div', { class: 'onboard' }, ico, title, body, dots), footer: h('div', { class: 'row between' }, skip, next), className: 'onboard-modal', onClose: () => setPref('onboarded', true) });
  render();
  next.focus();
}
