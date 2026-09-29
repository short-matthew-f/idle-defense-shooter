/**
 * Inline SVG icons (24×24 viewBox, stroke = currentColor). Static strings only.
 * Shapes carry meaning together with labels: rarity and statuses never rely on hue alone.
 */
import type { AbilityId, AnomalyRarity } from '@sim/core/ids';

const P: Record<string, string> = {
  scrap: '<path d="M12 3l7 9-7 9-7-9z" fill="currentColor" stroke="none"/>',
  cores: '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="3" fill="#0b0d12" stroke="none"/>',
  echo: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10" opacity=".5"/>',
  star: '<path d="M12 2.8l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.8l-5.8 3.3 1.5-6.4-4.9-4.3 6.5-.6z" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  forecast: '<path d="M3 20h18"/><path d="M4 16l5-6 4 3 7-8"/><circle cx="20" cy="5" r="1.6" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  upgrade: '<path d="M6 12.5l6-6 6 6M6 19l6-6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M13 6h8M13 11h6M13 16h4"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3" stroke-linecap="round"/>',
  codex: '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>',
  directives: '<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v4.5h11V15"/>',
  trials: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  prestige: '<path d="M12 20V5M6 11l6-6 6 6"/><path d="M4 21h16"/>',
  ascension: '<path d="M12 2.8l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.8l-5.8 3.3 1.5-6.4-4.9-4.3 6.5-.6z"/>',
  inspector: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  blueprint: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13 2L5 13.5h6L10 22l9-12h-6z" fill="currentColor" stroke="none"/>',
  skull: '<path d="M12 3a7.5 7.5 0 0 0-5 13v3h10v-3a7.5 7.5 0 0 0-5-13z"/><circle cx="9.3" cy="11" r="1.6" fill="currentColor"/><circle cx="14.7" cy="11" r="1.6" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  enemy: '<path d="M12 4l8 14H4z" fill="currentColor" stroke="none"/>',
  shop: '<path d="M4 7h16l-1.5 12h-13z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.4" stroke-linecap="round"/>',
  // rarity shapes
  r_common: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
  r_rare: '<path d="M12 4l8 8-8 8-8-8z" fill="currentColor" stroke="none"/>',
  r_paradox: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="none" stroke-width="2.4"/><path d="M8 8l8 8M16 8l-8 8"/>',
  r_cursed: '<path d="M12 3.5l9 16H3z" fill="currentColor" stroke="none"/><path d="M12 9.5v5M12 17h.01" stroke="#0b0d12" stroke-width="2.2"/>',
  // abilities
  a_hunter_mark: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>',
  a_repulsor_pulse: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>',
  a_time_field: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>',
  a_bombardment: '<circle cx="12" cy="13" r="6.5" fill="currentColor" stroke="none"/><path d="M15.5 7.5l3-3M18 3l1.8 1.8"/>',
  a_emp: '<path d="M13 2L6 13h5l-1 9 8-12h-5z"/><circle cx="12" cy="12" r="10.5" stroke-dasharray="3 3"/>',
  a_overdrive: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
  a_emergency_repair: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" stroke="none"/>',
  a_drone_surge: '<path d="M12 4l3 5h-6z M5 13l3 5H2z M19 13l3 5h-6z" fill="currentColor" stroke="none"/>',
  a_missile_storm: '<path d="M5 19L15 9M9 19L19 9M13 19l6-6"/><path d="M15 9V6h3M19 9V6" />',
  a_singularity_bomb: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3a9 9 0 0 1 9 9M21 12a9 9 0 0 1-9 9M12 21a9 9 0 0 1-9-9M3 12a9 9 0 0 1 9-9" stroke-dasharray="4 3"/>',
  a_designate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
};

export type IconName = keyof typeof P;

/** An inline SVG element for `name` (aria-hidden; pair with a text label or aria-label). */
export function icon(name: string, cls = 'ico'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = P[name] ?? P.info;
  return svg;
}

export function abilityIcon(id: AbilityId | 'designate', cls = 'ico'): SVGSVGElement { return icon(`a_${id}`, cls); }
export function rarityIcon(r: AnomalyRarity, cls = 'ico'): SVGSVGElement { return icon(`r_${r}`, cls); }
