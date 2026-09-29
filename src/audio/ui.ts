/**
 * Sound controls for the UI: the Settings → Sound section and the Battle mute chip. They talk to the
 * running GameAudio (gameAudio()); with no audio (tests, unsupported browsers) they still render and
 * persist prefs, so the choice holds once audio exists.
 */
import '../styles/audio.css';
import { button, h, attr } from '@ui/dom';
import { gameAudio, loadLevels, type Levels } from './index';
import { setPref } from '@ui/prefs';

type RowFn = (label: string, control: HTMLElement, hint?: string, stack?: boolean) => HTMLElement;
type ToggleFn = (label: string, on: boolean, change: (v: boolean) => void) => HTMLElement;

const PREF_KEY: Record<keyof Levels, 'soundMaster' | 'soundSfx' | 'soundMusic' | 'soundMuted' | 'musicOn'> = {
  master: 'soundMaster', sfx: 'soundSfx', music: 'soundMusic', muted: 'soundMuted', musicOn: 'musicOn',
};

function current(): Levels { return gameAudio()?.levels() ?? loadLevels(); }
function set(l: Partial<Levels>): void {
  const a = gameAudio();
  if (a) { a.setLevels(l); return; }
  for (const [k, v] of Object.entries(l) as [keyof Levels, number | boolean][]) setPref(PREF_KEY[k], v as never);
}

const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';
function speakerIcon(muted: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const body = document.createElementNS(ns, 'path');
  body.setAttribute('d', SPEAKER); body.setAttribute('fill', 'currentColor');
  svg.appendChild(body);
  const extra = document.createElementNS(ns, 'path');
  extra.setAttribute('d', muted ? 'M16 9.5l5 5M21 9.5l-5 5' : 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11');
  svg.appendChild(extra);
  return svg;
}

/** The Battle mute chip (36 px visible, 44 px hit area, like the other control chips). */
export function muteChip(): HTMLButtonElement {
  const b = button([], () => {
    const a = gameAudio();
    if (a) a.toggleMute(); else set({ muted: !current().muted });
    sync();
  }, { class: 'btn ctl icon mute-btn' });
  const sync = (): void => {
    const muted = current().muted;
    b.replaceChildren(speakerIcon(muted));
    b.classList.toggle('muted', muted);
    attr(b, 'aria-pressed', muted ? 'true' : 'false');
    attr(b, 'aria-label', muted ? 'Sound off. Tap to turn sound on' : 'Sound on. Tap to mute');
    b.title = muted ? 'Sound off (tap for sound)' : 'Mute sound';
  };
  sync();
  // follow changes made in Settings (the audio runtime exists once the game has started)
  let unsub: (() => void) | null = null;
  const hook = (): void => { const a = gameAudio(); if (a && !unsub) unsub = a.onChange(sync); };
  hook();
  if (!unsub) queueMicrotask(hook);
  return b;
}

/** Settings → Sound: Master, Effects and Music sliders, Mute, Music on/off, Test sound. */
export function soundSettings(row: RowFn, toggle: ToggleFn): HTMLElement[] {
  const L = current();
  const slider = (label: string, key: 'master' | 'sfx' | 'music'): HTMLElement => {
    const pct = h('span', { class: 'dim small', text: `${Math.round(L[key] * 100)}%` });
    const input = h('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.05', value: String(L[key]), 'aria-label': `${label} volume` } }) as HTMLInputElement;
    input.addEventListener('input', () => { const v = Number(input.value); pct.textContent = `${Math.round(v * 100)}%`; set({ [key]: v }); });
    return row(label, h('div', { class: 'range-wrap' }, input, pct), undefined, true);
  };
  const available = gameAudio()?.available ?? true;
  const test = button('Test sound', () => gameAudio()?.test(), { class: 'btn' });
  const out: HTMLElement[] = [
    h('h3', { class: 'sec-title', text: 'Sound' }),
    row('Sound', toggle('Sound', !L.muted, (v) => set({ muted: !v })), available ? 'The speaker chip on Battle mutes too' : 'This browser has no Web Audio'),
    slider('Master', 'master'),
    slider('Effects', 'sfx'),
    slider('Music', 'music'),
    row('Play music', toggle('Play music', L.musicOn, (v) => set({ musicOn: v })), 'Adaptive: it follows the Sector, the wave and the boss'),
    h('div', { class: 'row gap wrap sound-test' }, test),
  ];
  return out;
}
