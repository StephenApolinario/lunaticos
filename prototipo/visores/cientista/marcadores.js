// Marcadores de pontos da cena 3D projetados na tela (perigos relatados, abrigo de relevo).
// Independente do HUD: recebe a camada onde desenhar, a câmera e o relevo. As classes de
// CSS (`cientista-marker`) estão em componentes.css.

import * as THREE from 'three';
import { fmtDistance } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';

const MARKERS = Object.freeze({ maxDistM: 600, maxShown: 6, liftM: 1.2, minDepthM: 1 });
const ICONS = Object.freeze({ abrigo: '⌂' });

/**
 * @param {HTMLElement} layer Elemento que cobre a cena (posição absoluta, sem eventos de ponteiro).
 * @param {import('three').PerspectiveCamera} camera Com as matrizes já atualizadas no quadro.
 * @param {{ heightAt: (x: number, z: number) => number }} terrain
 */
export function createSceneMarkers(layer, camera, terrain) {
  const point = new THREE.Vector3();
  let entries = new Map();
  let size = { width: 0, height: 0 };
  new ResizeObserver(([entry]) => { size = { width: entry.contentRect.width, height: entry.contentRect.height }; }).observe(layer);

  function entryFor(item) {
    let entry = entries.get(item.id);
    if (!entry) {
      const label = h('span');
      const node = h('div', { class: 'cientista-marker', hidden: true }, h('p', { dataset: { type: item.type } }, h('i', {}, ICONS[item.type] ?? '!'), label));
      layer.append(node);
      entry = { node, label, x: NaN, z: NaN, y: 0 };
      entries.set(item.id, entry);
    }
    // Um marcador de id fixo pode mudar de lugar (o abrigo mais próximo muda com a caminhada).
    if (entry.x !== item.x || entry.z !== item.z) {
      entry.x = item.x;
      entry.z = item.z;
      entry.y = terrain.heightAt(item.x, item.z) + MARKERS.liftM;
    }
    return entry;
  }

  // Devolve true se o ponto está na frente da câmera e dentro da tela (e já posiciona o marcador).
  function place(item, entry) {
    point.set(item.x, entry.y, item.z).applyMatrix4(camera.matrixWorldInverse);
    if (point.z > -MARKERS.minDepthM) return false;
    point.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return false;
    const x = ((point.x + 1) / 2) * size.width;
    const y = ((1 - point.y) / 2) * size.height;
    entry.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    setText(entry.label, `${item.label} · ${fmtDistance(item.distM)}`);
    return true;
  }

  /** @param {ReadonlyArray<{ id: string, type: string, x: number, z: number, label: string, distM: number }>} items Do mais próximo ao mais distante. */
  function render(items) {
    const shown = new Set();
    for (const item of items) {
      if (shown.size >= MARKERS.maxShown || item.distM > MARKERS.maxDistM) break;
      if (place(item, entryFor(item))) shown.add(item.id);
    }
    for (const [id, entry] of entries) {
      const hide = !shown.has(id);
      if (entry.node.hidden !== hide) entry.node.hidden = hide;
    }
  }

  function clear() {
    entries.forEach((entry) => entry.node.remove());
    entries = new Map();
  }

  return Object.freeze({ render, clear });
}
