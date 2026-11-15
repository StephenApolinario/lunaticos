// Perfil de altitude à frente, em canvas 2D: os próximos metros da rota, com a linha colorida
// pelo declive em relação ao limite e uma faixa embaixo com a cobertura de rádio.

import { yToElev } from '../../src/geo.js';
import { COLORS } from '../../src/config.js';
import { fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { slopeLevel, limitFor } from './terreno.js';

export const PROFILE_WINDOW_M = Object.freeze({
  walk: Object.freeze({ behind: 60, ahead: 600, tick: 100 }),
  car: Object.freeze({ behind: 100, ahead: 1200, tick: 200 }),
});

const MAX_PIXEL_RATIO = 2;
const MIN_SPAN_M = 16;
const REDRAW_EVERY_M = 2;
// Mesmas cores das classes de declive do mapa do tablet (src/config.js).
const LEVEL_COLOR = Object.freeze({ attention: 'rgb(245, 200, 60)', near: 'rgb(240, 130, 40)', over: 'rgb(255, 90, 95)' });
const INK = Object.freeze({
  text: 'rgba(191, 243, 250, 0.72)',
  grid: 'rgba(191, 243, 250, 0.22)',
  self: '#f2fdff',
  radioOk: 'rgba(95, 211, 154, 0.9)',
  radioBlocked: 'rgba(255, 120, 124, 0.42)',
});

const levelBetween = (analysis, i) => {
  const steepest = Math.max(Math.abs(analysis.slopes[i]), Math.abs(analysis.slopes[i + 1]));
  return slopeLevel(steepest, limitFor(analysis.onFoot[i + 1] === 1));
};

// Chama `paint` uma vez para cada sequência de trechos com o mesmo valor de `keyAt`.
function eachRun(first, last, keyAt, paint) {
  let from = first;
  for (let i = first + 1; i <= last; i++) {
    if (i < last && keyAt(i) === keyAt(from)) continue;
    paint(keyAt(from), from, i);
    from = i;
  }
}

function summarize(analysis, distM, aheadM) {
  const from = Math.min(Math.round(distM / analysis.stepM), analysis.count - 1);
  const to = Math.min(Math.round((distM + aheadM) / analysis.stepM), analysis.count - 1);
  let peak = from;
  for (let i = from; i <= to; i++) if (Math.abs(analysis.slopes[i]) > Math.abs(analysis.slopes[peak])) peak = i;
  return { aheadM: (to - from) * analysis.stepM, gainM: analysis.ys[to] - analysis.ys[from], peakDeg: analysis.slopes[peak] };
}

// Janela da rota e as escalas que levam distância e altura para pixels.
function layout(analysis, span, distM, width, height, unit) {
  const fromM = distM - span.behind;
  const toM = distM + span.ahead;
  const first = Math.max(0, Math.floor(fromM / analysis.stepM));
  const last = Math.min(analysis.count - 1, Math.ceil(toM / analysis.stepM));
  let low = Infinity;
  let high = -Infinity;
  for (let i = first; i <= last; i++) {
    low = Math.min(low, analysis.ys[i]);
    high = Math.max(high, analysis.ys[i]);
  }
  const rangeM = Math.max(MIN_SPAN_M, high - low) * 1.2;
  const floorM = (low + high) / 2 - rangeM / 2;
  const left = 3 * unit;
  const right = width - 3 * unit;
  const top = 13 * unit;
  const base = height - 13 * unit;
  const xOf = (d) => left + ((d - fromM) / (toM - fromM)) * (right - left);
  return {
    unit, height, fromM, toM, first, last, top, base, xOf,
    xAt: (i) => xOf(Math.min(i * analysis.stepM, analysis.totalM)),
    yAt: (i) => base - ((analysis.ys[i] - floorM) / rangeM) * (base - top),
  };
}

function drawRelief(ctx, analysis, color, at) {
  const { unit, first, last, top, base, xAt, yAt } = at;
  ctx.beginPath();
  ctx.moveTo(xAt(first), base);
  for (let i = first; i <= last; i++) ctx.lineTo(xAt(i), yAt(i));
  ctx.lineTo(xAt(last), base);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, base);
  fill.addColorStop(0, 'rgba(191, 243, 250, 0.2)');
  fill.addColorStop(1, 'rgba(191, 243, 250, 0.02)');
  ctx.fillStyle = fill;
  ctx.fill();

  // A linha muda de cor e engrossa onde o declive passa de metade do limite.
  eachRun(first, last, (i) => levelBetween(analysis, i), (level, from, to) => {
    ctx.beginPath();
    ctx.moveTo(xAt(from), yAt(from));
    for (let i = from + 1; i <= to; i++) ctx.lineTo(xAt(i), yAt(i));
    ctx.strokeStyle = LEVEL_COLOR[level] ?? color;
    ctx.lineWidth = (level === 'ok' ? 1.6 : 3) * unit;
    ctx.stroke();
  });
}

// Faixa de rádio: verde onde há visada ao habitat.
function drawRadioBand(ctx, analysis, at) {
  const { unit, height, first, last, xAt } = at;
  eachRun(first, last, (i) => analysis.radio[Math.min(i + 1, analysis.count - 1)], (visible, from, to) => {
    ctx.fillStyle = visible === 1 ? INK.radioOk : INK.radioBlocked;
    ctx.fillRect(xAt(from), height - 7 * unit, Math.max(unit, xAt(to) - xAt(from) - unit), 3 * unit);
  });
}

function drawMarks(ctx, plan, analysis, color, span, distM, at) {
  const { unit, fromM, toM, top, base, xOf, xAt, yAt } = at;
  const labelY = top - 6 * unit;
  ctx.lineWidth = unit;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK.text;
  ctx.strokeStyle = INK.grid;
  for (let ahead = span.tick; ahead < span.ahead; ahead += span.tick) {
    const x = xOf(distM + ahead);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, base + 3 * unit);
    ctx.stroke();
    if ((ahead / span.tick) % 2 === 0) ctx.fillText(`${ahead} m`, x, labelY);
  }

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([3 * unit, 3 * unit]);
  for (const entry of plan.stops) {
    if (entry.distM < fromM || entry.distM > toM) continue;
    const x = xOf(entry.distM);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, base);
    ctx.stroke();
    ctx.fillText(t`P${entry.stop.id}`, x, labelY);
  }
  ctx.setLineDash([]);

  // Curvas: um triângulo apontando para o lado da curva.
  ctx.fillStyle = INK.self;
  for (const maneuver of analysis.maneuvers) {
    if (maneuver.distM < distM || maneuver.distM > toM) continue;
    const index = Math.round(maneuver.distM / analysis.stepM);
    const x = xAt(index);
    const y = yAt(index) - 8 * unit;
    const reach = (maneuver.side === 'direita' ? 4 : -4) * unit;
    ctx.beginPath();
    ctx.moveTo(x + reach, y);
    ctx.lineTo(x - reach * 0.6, y - 3.5 * unit);
    ctx.lineTo(x - reach * 0.6, y + 3.5 * unit);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHere(ctx, analysis, distM, at) {
  const { unit, top, base, xOf, yAt } = at;
  const here = Math.min(Math.round(distM / analysis.stepM), analysis.count - 1);
  const x = xOf(distM);
  ctx.strokeStyle = INK.self;
  ctx.fillStyle = INK.self;
  ctx.lineWidth = unit;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, base);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, yAt(here), 3 * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillText(`${fmtNumber(yToElev(analysis.ys[here]))} m`, x + 5 * unit, top - 6 * unit);
}

/** @param {HTMLCanvasElement} canvas */
export function createProfile(canvas) {
  const ctx = canvas.getContext('2d');
  let source = null;
  let lastKey = '';
  let summary = { aheadM: 0, gainM: 0, peakDeg: 0 };

  function setPlan(plan, analysis) {
    source = { plan, analysis, color: plan.mode === 'walk' ? COLORS.route : COLORS.vehicle, span: PROFILE_WINDOW_M[plan.mode] };
    lastKey = '';
  }

  /**
   * @param {number} distM Distância percorrida na rota.
   * @returns {{ aheadM: number, gainM: number, peakDeg: number }} Resumo do trecho à frente, para a legenda.
   */
  function draw(distM) {
    if (!ctx || !source) return summary;
    const unit = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.round(canvas.clientWidth * unit);
    const height = Math.round(canvas.clientHeight * unit);
    const key = `${width}|${height}|${Math.round(distM / REDRAW_EVERY_M)}`;
    if (width === 0 || height === 0 || key === lastKey) return summary;
    lastKey = key;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const { plan, analysis, color, span } = source;
    const at = layout(analysis, span, distM, width, height, unit);
    summary = summarize(analysis, distM, span.ahead);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = `500 ${9.5 * unit}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    drawRelief(ctx, analysis, color, at);
    drawRadioBand(ctx, analysis, at);
    drawMarks(ctx, plan, analysis, color, span, distM, at);
    drawHere(ctx, analysis, distM, at);
    return summary;
  }

  return Object.freeze({ setPlan, draw });
}
