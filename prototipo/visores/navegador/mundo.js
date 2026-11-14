// Guia ancorada no mundo, desenhada em canvas 2D por cima da cena: divisas no chão ao longo da rota,
// destaque e distância nas curvas, linha de retomada quando fora da rota e o indicador de borda de tela.
// Os pontos são projetados com as matrizes da câmera, então acompanham o relevo e a perspectiva.

import { clamp } from '../../src/geo.js';
import { fmtDistance } from '../../src/format.js';
import { COLORS } from '../../src/config.js';
import { h, setText } from '../../src/dom.js';
import { routeAt } from './analise.js';

const DEG = Math.PI / 180;
const MAX_PIXEL_RATIO = 2;
const LIFT_M = 0.25;
const MIN_DEPTH_M = 0.6;
const CHEVRON = Object.freeze({
  firstM: 5, growth: 1.42, slots: 10, cycleS: 1.6, alpha: 0.9,
  foot: Object.freeze({ widthM: 1.5, lengthM: 0.8, strokeM: 0.16, reach: 1 }),
  cabin: Object.freeze({ widthM: 2.6, lengthM: 1.3, strokeM: 0.24, reach: 1.5 }),
  turnReachM: 14, turnScale: 1.6, minStrokePx: 1.2, maxStrokePx: 8,
});
const OCCLUSION = Object.freeze({ samples: 5, slackM: 0.4, alpha: 0.28 });
const TURN_LABEL = Object.freeze({ maxM: 320, liftM: 2.6 });
const REJOIN = Object.freeze({ stepM: 3, maxPoints: 40 });
const EDGE = Object.freeze({ insetPx: 26, behindFlatten: 0.3, sideCos: 0.35 });
const TURN_COLOR = '#ffffff';

/**
 * Elemento do indicador de borda (seta mais rótulo), para pôr dentro do elemento que cobre a cena.
 * O estilo está em componentes.css.
 * @returns {HTMLElement}
 */
export function createEdgeIndicator() {
  return h('div', { class: 'navegador-borda', hidden: true }, h('i', { 'aria-hidden': 'true' }), h('span'));
}

/**
 * @param {{ canvas: HTMLCanvasElement, camera: import('three').PerspectiveCamera,
 *   heightAt: (x: number, z: number) => number, edge?: HTMLElement }} deps
 *   `canvas` cobre a cena inteira (classe `navegador-mundo`). `edge` vem de `createEdgeIndicator`;
 *   sem ele, `pointTo` não faz nada.
 */
export function createWorldGuide({ canvas, camera, heightAt, edge = null }) {
  const ctx = canvas.getContext('2d');
  const edgeArrow = edge?.querySelector('i') ?? null;
  const edgeLabel = edge?.querySelector('span') ?? null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let unit = 1;

  function fit(cssWidth, cssHeight) {
    unit = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    width = Math.round(cssWidth * unit);
    height = Math.round(cssHeight * unit);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  // Ponto do mundo para pixels do canvas. `depth` é a distância à frente da câmera (negativa = atrás).
  function project(x, y, z) {
    const view = camera.matrixWorldInverse.elements;
    const lens = camera.projectionMatrix.elements;
    const cx = view[0] * x + view[4] * y + view[8] * z + view[12];
    const cy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const depth = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
    return { cx, cy, depth, x: (0.5 + (0.5 * lens[0] * cx) / depth) * width, y: (0.5 - (0.5 * lens[5] * cy) / depth) * height };
  }

  const onGround = (x, z) => project(x, heightAt(x, z) + LIFT_M, z);

  // O relevo entre o olho e o ponto esconde o ponto?
  function isOccluded(eye, x, y, z) {
    for (let k = 1; k <= OCCLUSION.samples; k++) {
      const t = k / (OCCLUSION.samples + 1);
      const sightY = eye.y + (y - eye.y) * t;
      if (heightAt(eye.x + (x - eye.x) * t, eye.z + (z - eye.z) * t) > sightY + OCCLUSION.slackM) return true;
    }
    return false;
  }

  // Uma divisa deitada no chão, apontando no sentido da rota.
  function drawChevron(analysis, distM, shape, scale, eye, color, alpha) {
    const at = routeAt(analysis, distM);
    const before = routeAt(analysis, distM - 2);
    const after = routeAt(analysis, distM + 2);
    const length = Math.hypot(after.x - before.x, after.z - before.z);
    if (length < 1e-3) return;
    const fx = (after.x - before.x) / length;
    const fz = (after.z - before.z) / length;
    const halfLength = (shape.lengthM * scale) / 2;
    const halfWidth = (shape.widthM * scale) / 2;
    // Direita do sentido de marcha = (-fz, fx).
    const tip = onGround(at.x + fx * halfLength, at.z + fz * halfLength);
    const left = onGround(at.x - fx * halfLength + fz * halfWidth, at.z - fz * halfLength - fx * halfWidth);
    const right = onGround(at.x - fx * halfLength - fz * halfWidth, at.z - fz * halfLength + fx * halfWidth);
    if (Math.min(tip.depth, left.depth, right.depth) < MIN_DEPTH_M) return;

    const focalPx = (camera.projectionMatrix.elements[5] * height) / 2;
    const strokePx = (shape.strokeM * scale * focalPx) / tip.depth;
    ctx.globalAlpha = alpha * (isOccluded(eye, at.x, at.y + LIFT_M, at.z) ? OCCLUSION.alpha : 1);
    ctx.lineWidth = clamp(strokePx, CHEVRON.minStrokePx * unit, CHEVRON.maxStrokePx * unit);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  // As divisas correm para a frente: cada uma desliza da sua casa até a seguinte e a fila recomeça.
  function drawChevrons(scene) {
    const shape = scene.onFoot ? CHEVRON.foot : CHEVRON.cabin;
    const phase = reducedMotion ? 0.5 : (scene.timeS / CHEVRON.cycleS) % 1;
    for (let slot = 0; slot < CHEVRON.slots; slot++) {
      const distM = scene.distM + CHEVRON.firstM * shape.reach * CHEVRON.growth ** (slot + phase);
      if (distM > scene.limitM) break;
      let alpha = CHEVRON.alpha;
      if (slot === 0) alpha *= phase;
      if (slot === CHEVRON.slots - 1) alpha *= 1 - phase;
      const atTurn = scene.maneuver !== null && Math.abs(scene.maneuver.distM - distM) <= CHEVRON.turnReachM;
      drawChevron(scene.analysis, distM, shape, atTurn ? CHEVRON.turnScale : 1, scene.eye, atTurn ? TURN_COLOR : scene.color, alpha);
    }
  }

  // Etiqueta flutuando sobre a próxima curva: um triângulo para o lado da curva e a distância até ela.
  function drawTurnLabel(scene) {
    const { maneuver, analysis } = scene;
    const untilM = maneuver.distM - scene.distM;
    if (untilM < 0 || untilM > TURN_LABEL.maxM || maneuver.distM > scene.limitM) return;
    const at = routeAt(analysis, maneuver.distM);
    const point = project(at.x, at.y + TURN_LABEL.liftM, at.z);
    if (point.depth < MIN_DEPTH_M) return;
    const text = fmtDistance(untilM);
    ctx.font = `600 ${11 * unit}px "IBM Plex Mono", monospace`;
    const boxWidth = ctx.measureText(text).width + 30 * unit;
    const boxHeight = 20 * unit;
    const left = point.x - boxWidth / 2;
    const top = point.y - boxHeight;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(4, 10, 14, 0.78)';
    ctx.fillRect(left, top, boxWidth, boxHeight);
    ctx.strokeStyle = TURN_COLOR;
    ctx.lineWidth = unit;
    ctx.strokeRect(left, top, boxWidth, boxHeight);

    const reach = (maneuver.deltaDeg >= 0 ? 5 : -5) * unit;
    const midY = top + boxHeight / 2;
    const arrowX = left + 11 * unit;
    ctx.fillStyle = TURN_COLOR;
    ctx.beginPath();
    ctx.moveTo(arrowX + reach, midY);
    ctx.lineTo(arrowX - reach * 0.6, midY - 4.5 * unit);
    ctx.lineTo(arrowX - reach * 0.6, midY + 4.5 * unit);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 20 * unit, midY + unit);
  }

  // Fora da rota: linha tracejada no chão, dos pés até o ponto de retomada.
  function drawRejoin(scene) {
    const { feet, rejoin } = scene;
    const points = clamp(Math.ceil(Math.hypot(rejoin.x - feet.x, rejoin.z - feet.z) / REJOIN.stepM), 2, REJOIN.maxPoints);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = COLORS.vehicle;
    ctx.lineWidth = 2.5 * unit;
    ctx.setLineDash([8 * unit, 7 * unit]);
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i <= points; i++) {
      const t = i / points;
      const point = onGround(feet.x + (rejoin.x - feet.x) * t, feet.z + (rejoin.z - feet.z) * t);
      if (point.depth < MIN_DEPTH_M) {
        drawing = false;
      } else if (drawing) {
        ctx.lineTo(point.x, point.y);
      } else {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * @param {{ analysis: object, distM: number, limitM: number, onFoot: boolean, color: string, timeS: number,
   *   eye: { x: number, y: number, z: number }, maneuver: { distM: number, deltaDeg: number } | null,
   *   feet: { x: number, z: number }, rejoin: { x: number, z: number } | null, cssWidth: number, cssHeight: number }} scene
   */
  function draw(scene) {
    if (!ctx || scene.cssWidth === 0 || scene.cssHeight === 0) return;
    fit(scene.cssWidth, scene.cssHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawChevrons(scene);
    if (scene.maneuver) drawTurnLabel(scene);
    if (scene.rejoin) drawRejoin(scene);
    ctx.globalAlpha = 1;
  }

  /**
   * Indicador de borda: aparece quando o alvo está fora da área livre do visor e aponta para ele.
   * @param {{ x: number, y: number, z: number, label: string } | null} target
   * @param {{ left: number, top: number, width: number, height: number }} bounds Área livre, em pixels de CSS.
   */
  function pointTo(target, bounds) {
    if (!edge) return;
    if (!target || bounds.width === 0) {
      if (!edge.hidden) edge.hidden = true;
      return;
    }
    const point = project(target.x, target.y, target.z);
    const inFront = point.depth > MIN_DEPTH_M;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const screenX = point.x / unit;
    const screenY = point.y / unit;
    const insideX = screenX > bounds.left && screenX < bounds.left + bounds.width;
    const insideY = screenY > 0 && screenY < bounds.top + bounds.height;
    if (inFront && insideX && insideY) {
      if (!edge.hidden) edge.hidden = true;
      return;
    }
    // Atrás da câmera a projeção não vale: usa a direção no espaço da câmera, puxada para os lados.
    const dx = inFront ? screenX - centerX : point.cx;
    const dy = inFront ? screenY - centerY : -point.cy * EDGE.behindFlatten;
    const angle = Math.atan2(dy, dx || 1e-6);
    const x = centerX + Math.cos(angle) * Math.max(10, bounds.width / 2 - EDGE.insetPx);
    const y = centerY + Math.sin(angle) * Math.max(10, bounds.height / 2 - EDGE.insetPx);
    let side = 'center';
    if (Math.cos(angle) > EDGE.sideCos) side = 'right';
    else if (Math.cos(angle) < -EDGE.sideCos) side = 'left';
    if (edge.dataset.side !== side) edge.dataset.side = side;
    edge.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    edgeArrow.style.transform = `rotate(${Math.round(angle / DEG)}deg)`;
    setText(edgeLabel, target.label);
    if (edge.hidden) edge.hidden = false;
  }

  return Object.freeze({ draw, pointTo });
}
