// Marcador da área mapeada sobre o globo. ILUSTRATIVO: a área tem poucos quilômetros e some na
// escala do planeta; o anel só mostra onde ela fica e serve de botão para entrar nela.
// O estilo vai junto com o módulo, usando as cores da página quando elas existem.

import { h } from './dom.js';

const STYLE_ID = 'globe-marker-style';
const CAPTION = 'Área mapeada';
// Tamanho do ponto clicável no centro e do anel quando a área é menor que ele na tela.
const SPOT_PX = 30;
const STYLE = `
.globe-overlay { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
.globe-marker {
  position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 10px;
  margin: 0; padding: 0; border: 0; background: none; color: var(--fg, #e5eaef);
  font: inherit; text-align: left; cursor: pointer; pointer-events: auto;
}
.globe-marker[hidden] { display: none; }
.globe-marker:focus-visible { outline: 2px solid var(--accent, #ec7a45); outline-offset: 4px; border-radius: 6px; }
.globe-marker-spot { position: relative; flex: none; width: ${SPOT_PX}px; height: ${SPOT_PX}px; }
.globe-marker-ring {
  position: absolute; left: 50%; top: 50%; width: ${SPOT_PX}px; height: ${SPOT_PX}px;
  transform: translate(-50%, -50%); border: 2px solid var(--accent, #ec7a45); border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(4, 7, 10, 0.7), inset 0 0 0 1px rgba(4, 7, 10, 0.7); pointer-events: none;
}
.globe-marker-ring::after {
  content: ""; position: absolute; inset: -2px; border: 2px solid var(--accent, #ec7a45); border-radius: 50%;
  animation: globe-marker-pulse 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}
.globe-marker-text {
  display: grid; gap: 2px; padding: 6px 10px; white-space: nowrap;
  border: 1px solid var(--line, #25303b); border-radius: 6px; background: rgba(11, 15, 19, 0.84);
  transition: border-color 150ms ease-out;
}
.globe-marker:hover .globe-marker-text, .globe-marker:focus-visible .globe-marker-text { border-color: var(--accent, #ec7a45); }
.globe-marker:active .globe-marker-text { background: rgba(24, 33, 42, 0.92); }
.globe-marker-text strong { font: 600 13px/1.2 var(--display, system-ui, sans-serif); color: var(--heading, #fafafa); }
.globe-marker-text span {
  font: 500 10px/1.2 var(--mono, ui-monospace, monospace); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent, #ec7a45);
}
@keyframes globe-marker-pulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.9); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .globe-marker-ring::after { animation: none; opacity: 0; } }
`;

function ensureStyle() {
  if (!document.getElementById(STYLE_ID)) document.head.append(h('style', { id: STYLE_ID }, STYLE));
}

/**
 * @param {HTMLElement} container Recebe a camada do marcador, por cima do canvas.
 * @param {{
 *   label: string,
 *   onActivate: () => void,
 *   onWheel: (event: WheelEvent) => void,  // a roda sobre o marcador, para quem cuida do zoom
 * }} options
 * @returns {{
 *   place(position: { x: number, y: number, ringPx: number, visible: boolean }): void,  // em pixels do container
 *   setShown(shown: boolean): void,
 *   dispose(): void,
 * }}
 */
export function createMarker(container, { label, onActivate, onWheel }) {
  ensureStyle();
  const ring = h('span', { class: 'globe-marker-ring' });
  const button = h('button', {
    class: 'globe-marker', type: 'button', hidden: true, 'aria-label': `Entrar na área mapeada: ${label}`,
    onclick: onActivate,
    // O marcador fica por cima do canvas, justamente onde se mira para aproximar: a roda sobre ele
    // segue para o zoom do globo e não sobe para a página.
    onwheel: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onWheel(event);
    },
  },
  h('span', { class: 'globe-marker-spot', 'aria-hidden': 'true' }, ring),
  h('span', { class: 'globe-marker-text' }, h('strong', {}, label), h('span', {}, CAPTION)));
  const root = h('div', { class: 'globe-overlay', hidden: true }, button);
  container.append(root);

  function place({ x, y, ringPx, visible }) {
    button.hidden = !visible;
    if (!visible) return;
    // O anel cresce junto com a área quando ela passa a ser maior que ele na tela.
    const size = `${Math.max(SPOT_PX, ringPx).toFixed(1)}px`;
    ring.style.width = size;
    ring.style.height = size;
    button.style.transform = `translate(${(x - SPOT_PX / 2).toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
  }

  return Object.freeze({
    place,
    setShown: (shown) => { root.hidden = !shown; },
    dispose: () => root.remove(),
  });
}
