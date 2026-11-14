// Minimapa em canvas 2D: vista de cima centrada no astronauta, girando com o rumo (o rumo fica para cima).
// Mostra rota, paradas, trajeto do Curiosity, zona de rochas cortantes, habitat, norte e a visada de rádio.

import { TRACK, HAZARD } from '../../data/travessia.js';
import { toLocal } from '../../src/geo.js';
import { COLORS } from '../../src/config.js';
import { HABITAT } from './analise.js';

export const ZOOM_RADII_M = Object.freeze([150, 400, 1000, 2500]);
export const DEFAULT_ZOOM = 1;

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const MAX_PIXEL_RATIO = 2;
const VIEW_HALF_ANGLE_DEG = 34;
const INK = Object.freeze({
  disc: 'rgba(4, 10, 14, 0.66)',
  ring: 'rgba(191, 243, 250, 0.2)',
  text: 'rgba(191, 243, 250, 0.75)',
  track: 'rgba(255, 255, 255, 0.55)',
  hazardFill: 'rgba(239, 74, 79, 0.2)',
  radioHalo: 'rgba(95, 211, 154, 0.34)',
  radioOk: 'rgba(95, 211, 154, 0.95)',
  radioBlocked: 'rgba(255, 120, 124, 0.9)',
  wedge: 'rgba(191, 243, 250, 0.12)',
  self: '#f2fdff',
  dark: '#0e141a',
});

const TRACK_POINTS = TRACK.map(([lat, lon]) => toLocal(lat, lon));
const HAZARD_LOCAL = Object.freeze({ ...toLocal(HAZARD.lat, HAZARD.lon), radiusM: HAZARD.radiusKm * 1000 });
const HABITAT_POINT = Object.freeze({ id: 'H', ...HABITAT });

const ringLabel = (meters) => (meters >= 1000 ? `${(meters / 1000).toLocaleString('pt-BR')} km` : `${meters} m`);

// Trechos da rota com o mesmo estilo: volta tracejada, trecho bloqueado para veículo em vermelho.
function routeSpans(plan, analysis, color) {
  const returnIndex = Math.round(analysis.returnFromM / analysis.stepM);
  const styleAt = (i) => (i > returnIndex ? 2 : 0) + (plan.mode === 'car' && analysis.onFoot[i] === 1 ? 1 : 0);
  const spans = [];
  let from = 1;
  for (let i = 2; i <= analysis.count; i++) {
    if (i < analysis.count && styleAt(i) === styleAt(from)) continue;
    spans.push({ from: from - 1, to: i - 1, dashed: styleAt(from) >= 2, color: styleAt(from) % 2 === 1 ? COLORS.hazard : color });
    from = i;
  }
  return spans;
}

/** @param {HTMLCanvasElement} canvas */
export function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  let route = null;
  let lastKey = '';

  function setPlan(plan, analysis) {
    const color = plan.mode === 'walk' ? COLORS.route : COLORS.vehicle;
    // As paradas vêm do plano: pode ser a travessia ou um destino livre escolhido no mapa.
    const stops = [HABITAT_POINT, ...plan.stops.map(({ stop }) => ({ id: stop.id, ...toLocal(stop.lat, stop.lon) }))];
    route = { analysis, color, stops, spans: routeSpans(plan, analysis, color) };
    lastKey = '';
  }

  function strokeRange(from, to) {
    if (to <= from) return;
    const { xs, zs } = route.analysis;
    ctx.beginPath();
    ctx.moveTo(xs[from], zs[from]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(xs[i], zs[i]);
    ctx.stroke();
  }

  // Tudo o que é desenhado em metros, já com o mapa girado e centrado. `px` = um pixel de tela em metros.
  function drawWorld(view, px) {
    const { analysis, spans } = route;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(HAZARD_LOCAL.x, HAZARD_LOCAL.z, HAZARD_LOCAL.radiusM, 0, TWO_PI);
    ctx.fillStyle = INK.hazardFill;
    ctx.fill();
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = COLORS.hazard;
    ctx.stroke();

    ctx.setLineDash([3 * px, 4 * px]);
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = INK.track;
    ctx.beginPath();
    TRACK_POINTS.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.z) : ctx.lineTo(point.x, point.z)));
    ctx.stroke();

    // Halo verde onde a rota tem visada de rádio ao habitat.
    ctx.setLineDash([]);
    ctx.lineWidth = 8 * px;
    ctx.strokeStyle = INK.radioHalo;
    for (const segment of analysis.radioSegments) {
      if (segment.visible) strokeRange(Math.round(segment.fromM / analysis.stepM), Math.min(Math.round(segment.toM / analysis.stepM), analysis.count - 1));
    }

    // A rota: o que já foi percorrido fica apagado.
    const current = Math.round(view.distM / analysis.stepM);
    ctx.lineWidth = 2.4 * px;
    for (const span of spans) {
      ctx.strokeStyle = span.color;
      ctx.setLineDash(span.dashed ? [7 * px, 5 * px] : []);
      ctx.globalAlpha = 0.32;
      strokeRange(span.from, Math.min(span.to, current));
      ctx.globalAlpha = 1;
      strokeRange(Math.max(span.from, current), span.to);
    }
    ctx.setLineDash([]);
  }

  function drawStop(stop, at, isTarget, unit, radius) {
    const reach = Math.hypot(at.x, at.y);
    const limit = radius - 10 * unit;
    const outside = reach > limit;
    // Fora do alcance só aparecem o habitat e o alvo, presos à borda para dar a direção.
    if (outside && !isTarget && stop.id !== 'H') return;
    const scale = outside ? limit / reach : 1;
    const x = radius + at.x * scale;
    const y = radius + at.y * scale;
    ctx.beginPath();
    ctx.arc(x, y, (outside ? 6 : 7.5) * unit, 0, TWO_PI);
    ctx.fillStyle = stop.id === 'H' ? COLORS.accent : INK.dark;
    ctx.fill();
    ctx.lineWidth = (isTarget ? 2 : 1.3) * unit;
    ctx.strokeStyle = isTarget ? INK.self : route.color;
    ctx.stroke();
    ctx.fillStyle = INK.self;
    ctx.fillText(stop.id, x, y + 0.5 * unit);
  }

  // Linha até o habitat: verde com visada, vermelha tracejada sem, com um X onde o relevo bloqueia.
  function drawRadioLine(view, home, unit, radius, scale) {
    const reach = Math.hypot(home.x, home.y);
    if (reach < 1) return;
    ctx.setLineDash(view.radio.visible ? [] : [3 * unit, 4 * unit]);
    ctx.lineWidth = 1.2 * unit;
    ctx.strokeStyle = view.radio.visible ? INK.radioOk : INK.radioBlocked;
    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.lineTo(radius + home.x, radius + home.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const blockPx = view.radio.blockAtM * scale;
    if (view.radio.visible || blockPx > radius) return;
    const x = radius + (home.x / reach) * blockPx;
    const y = radius + (home.y / reach) * blockPx;
    const arm = 3.5 * unit;
    ctx.lineWidth = 1.8 * unit;
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
    ctx.stroke();
  }

  function drawSelf(view, unit, radius) {
    const look = (view.lookDeg - 90) * DEG;
    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius * 0.6, look - VIEW_HALF_ANGLE_DEG * DEG, look + VIEW_HALF_ANGLE_DEG * DEG);
    ctx.closePath();
    ctx.fillStyle = INK.wedge;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(radius, radius - 8 * unit);
    ctx.lineTo(radius - 5.5 * unit, radius + 6 * unit);
    ctx.lineTo(radius, radius + 3 * unit);
    ctx.lineTo(radius + 5.5 * unit, radius + 6 * unit);
    ctx.closePath();
    ctx.fillStyle = INK.self;
    ctx.fill();
    ctx.lineWidth = unit;
    ctx.strokeStyle = INK.dark;
    ctx.stroke();
  }

  function drawFrame(view, unit, radius) {
    ctx.lineWidth = unit;
    ctx.strokeStyle = INK.ring;
    for (const fraction of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(radius, radius, (radius - unit) * fraction, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.fillStyle = INK.text;
    ctx.textAlign = 'left';
    ctx.fillText(ringLabel(view.radiusM / 2), radius + 4 * unit, radius + radius / 2 - 7 * unit);
    ctx.textAlign = 'center';

    // Norte: na borda, do lado para onde ele fica com o mapa girado.
    const heading = view.headingDeg * DEG;
    const reach = radius - 11 * unit;
    ctx.font = `600 ${11 * unit}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = COLORS.accent;
    ctx.fillText('N', radius - Math.sin(heading) * reach, radius - Math.cos(heading) * reach);
  }

  /**
   * @param {{ x: number, z: number, headingDeg: number, lookDeg: number, distM: number, radiusM: number,
   *   targetId: string, rejoin: { x: number, z: number } | null, radio: { visible: boolean, blockAtM: number } }} view
   */
  function draw(view) {
    if (!ctx || !route) return;
    const unit = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const size = Math.round(canvas.clientWidth * unit);
    if (size === 0) return;
    const radius = size / 2;
    const scale = radius / view.radiusM;
    const key = [
      size, view.radiusM, Math.round(view.x * scale), Math.round(view.z * scale), Math.round(view.headingDeg * 2),
      Math.round(view.lookDeg / 2), Math.round(view.distM / 5), view.targetId, view.radio.visible, Math.round(view.radio.blockAtM / 10),
      view.rejoin ? Math.round(view.rejoin.x) : '',
    ].join('|');
    if (key === lastKey) return;
    lastKey = key;
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const cos = Math.cos(-view.headingDeg * DEG);
    const sin = Math.sin(-view.headingDeg * DEG);
    // Posição na tela, em pixels a partir do centro.
    const place = (point) => {
      const dx = (point.x - view.x) * scale;
      const dz = (point.z - view.z) * scale;
      return { x: dx * cos - dz * sin, y: dx * sin + dz * cos };
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(radius, radius, radius - unit, 0, TWO_PI);
    ctx.clip();
    ctx.fillStyle = INK.disc;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(radius, radius);
    ctx.rotate(-view.headingDeg * DEG);
    ctx.scale(scale, scale);
    ctx.translate(-view.x, -view.z);
    drawWorld(view, unit / scale);
    ctx.restore();

    ctx.font = `500 ${9.5 * unit}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawRadioLine(view, place(HABITAT_POINT), unit, radius, scale);
    if (view.rejoin) {
      const at = place(view.rejoin);
      ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.lineWidth = 1.6 * unit;
      ctx.strokeStyle = COLORS.vehicle;
      ctx.beginPath();
      ctx.moveTo(radius, radius);
      ctx.lineTo(radius + at.x, radius + at.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const stop of route.stops) drawStop(stop, place(stop), stop.id === view.targetId, unit, radius);
    drawSelf(view, unit, radius);
    drawFrame(view, unit, radius);
    ctx.restore();
  }

  return Object.freeze({ setPlan, draw });
}
