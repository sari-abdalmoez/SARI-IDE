'use strict';
/* Inline SVG icon set (stroke-based, 24x24, currentColor) — replaces every emoji used as a UI icon. */
const ICON_PATHS = {
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  settings: '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.8 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  'folder-open': '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19a1 1 0 0 1 .97 1.24l-1.6 6.4A1.5 1.5 0 0 1 16.9 17H5.5A1.5 1.5 0 0 1 4 15.7z"/>',
  'file': '<path d="M6.5 3h7L18 7.5V20a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><polyline points="13.2 3.2 13.2 7.8 17.8 7.8"/>',
  'file-plus': '<path d="M6.5 3h7L18 7.5V20a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><polyline points="13.2 3.2 13.2 7.8 17.8 7.8"/><line x1="9" y1="14.5" x2="15" y2="14.5"/><line x1="12" y1="11.5" x2="12" y2="17.5"/>',
  'folder-plus': '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.8 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/>',
  upload: '<path d="M12 15.5V4.2"/><polyline points="7.2 9 12 4.2 16.8 9"/><path d="M4.5 15.5v3a1.2 1.2 0 0 0 1.2 1.2h12.6a1.2 1.2 0 0 0 1.2-1.2v-3"/>',
  download: '<path d="M12 4.2v11.3"/><polyline points="7.2 10.5 12 15.5 16.8 10.5"/><path d="M4.5 15.5v3a1.2 1.2 0 0 0 1.2 1.2h12.6a1.2 1.2 0 0 0 1.2-1.2v-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.2"/><line x1="15.2" y1="15.2" x2="20.5" y2="20.5"/>',
  refresh: '<path d="M4.6 11.5a7.5 7.5 0 1 1 1.9 5.1"/><polyline points="4.4 17.8 4.6 12.6 9.8 13"/>',
  github: '<path d="M12 2.2c-5.4 0-9.8 4.4-9.8 9.8 0 4.3 2.8 8 6.7 9.3.5.1.7-.2.7-.5v-1.9c-2.7.6-3.3-1.3-3.3-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.2-4.4-1.1-4.4-4.8 0-1 .4-1.9 1-2.6-.1-.2-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.5.1 2.7.6.7 1 1.6 1 2.6 0 3.7-2.2 4.6-4.4 4.8.4.3.7.9.7 1.9v2.7c0 .3.2.6.7.5 3.9-1.3 6.7-5 6.7-9.3 0-5.4-4.4-9.8-9.8-9.8z"/>',
  save: '<path d="M5.5 3.5h10l3 3v13a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M8 3.5v5h6.5v-5"/><rect x="8" y="13" width="8" height="6.5"/>',
  play: '<path d="M7.5 4.8v14.4a1 1 0 0 0 1.5.87l12-7.2a1 1 0 0 0 0-1.74l-12-7.2a1 1 0 0 0-1.5.87z"/>',
  build: '<path d="M14.7 6.3l3 3-8.4 8.4-3.6.6.6-3.6z"/><path d="M17 3.7l3.3 3.3"/><line x1="3" y1="21" x2="8.3" y2="21"/>',
  'more-vert': '<circle cx="12" cy="6" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18" r="1.3"/>',
  'more-horiz': '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  close: '<line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/><line x1="18.5" y1="5.5" x2="5.5" y2="18.5"/>',
  back: '<polyline points="15 5 8 12 15 19"/>',
  trash: '<path d="M5 7h14"/><path d="M9 7V4.6A1.1 1.1 0 0 1 10.1 3.5h3.8A1.1 1.1 0 0 1 15 4.6V7"/><path d="M7 7l1 12.4A1.2 1.2 0 0 0 9.2 20.5h5.6a1.2 1.2 0 0 0 1.2-1.1L17 7"/>',
  console: '<rect x="3" y="4.5" width="18" height="15" rx="1.4"/><polyline points="7.2 9.5 11 12.3 7.2 15.1"/><line x1="12.5" y1="15.5" x2="16.8" y2="15.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="1.6"/><polyline points="7 9 10.5 12 7 15"/><line x1="12.5" y1="15.5" x2="17" y2="15.5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  eject: '<path d="M16 3.8h4.5v16.4H16"/><polyline points="10.5 7.5 15 12 10.5 16.5"/><line x1="15" y1="12" x2="3" y2="12"/>',
  branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="17" cy="9.5" r="2"/><path d="M6 7.5v9"/><path d="M6 9c0 4 3 6 9 6"/><path d="M6 9c0 -1.5 5.5 -2 5.5 -3.5"/>',
  check: '<polyline points="5 12.5 10 17.5 19.5 6.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.3"/><path d="M15 9V5.3A1.3 1.3 0 0 0 13.7 4H5.3A1.3 1.3 0 0 0 4 5.3v8.4A1.3 1.3 0 0 0 5.3 15H9"/>',
  send: '<line x1="20.5" y1="3.5" x2="10.5" y2="13.5"/><polygon points="20.5 3.5 14 20.5 10.5 13.5 3.5 10 20.5 3.5"/>',
};
function iconSvg(name, cls) {
  const p = ICON_PATHS[name] || '';
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function applyIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(el => {
    if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', iconSvg(el.dataset.icon));
  });
}
document.addEventListener('DOMContentLoaded', () => applyIcons());
