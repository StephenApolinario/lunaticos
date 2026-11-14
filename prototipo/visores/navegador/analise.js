// Análise do plano sobre o relevo. Amostra a rota a cada 10 m e deriva, uma vez por plano:
// declive (lido do relevo), ritmo simulado, cobertura de rádio, proximidade da zona de risco e curvas.

import { toLocal, headingDeg, angleDeltaDeg, clamp, lerp } from '../../src/geo.js';
import { samplePath, findStop } from '../../src/route.js';
import { lineOfSight, ANTENNA_M } from './radio.js';
import { paceFactor, slopeLevel, limitFor, hazardEdgeM, hazardSideOf } from './terreno.js';

export const STEP_M = 10;
const RAD_TO_DEG = 180 / Math.PI;
const RADIO_EVERY = 2; // visada calculada a cada 20 m de rota
const RADIO_MIN_RUN = 4; // mudança de menos de 40 m não conta como trecho
const HAZARD_NEAR_M = 120;
const TURN = Object.freeze({
  armSamples: 3, minDeg: 35, slightDeg: 55, sharpDeg: 120, uturnDeg: 160,
  stopRadiusM: 25, climbFromM: 10, climbToM: 50,
});

/** Posição do habitat (parada H), onde fica o mastro de rádio. */
export const HABITAT = Object.freeze({ ...toLocal(findStop('H').lat, findStop('H').lon) });

const distOf = (route, index) => Math.min(index * STEP_M, route.totalM);

function sampleRoute(path, heightAt) {
  // Pelo menos duas amostras, para a interpolação valer até numa rota de comprimento zero.
  const count = Math.max(2, Math.ceil(path.totalM / STEP_M) + 1);
  const route = {
    count, totalM: path.totalM, stepM: STEP_M,
    xs: new Float32Array(count), zs: new Float32Array(count), ys: new Float32Array(count),
    speedKmh: new Float32Array(count), onFoot: new Uint8Array(count),
  };
  for (let i = 0; i < count; i++) {
    const sample = samplePath(path, distOf(route, i));
    route.xs[i] = sample.x;
    route.zs[i] = sample.z;
    route.ys[i] = heightAt(sample.x, sample.z);
    route.speedKmh[i] = sample.speedKmh;
    route.onFoot[i] = sample.onFoot ? 1 : 0;
  }
  return route;
}

// Declive ao longo da rota, em graus, numa janela de 20 m. Positivo = subida.
function slopesOf(route) {
  const slopes = new Float32Array(route.count);
  for (let i = 0; i < route.count; i++) {
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 1, route.count - 1);
    const runM = distOf(route, b) - distOf(route, a);
    slopes[i] = runM > 0 ? Math.atan((route.ys[b] - route.ys[a]) / runM) * RAD_TO_DEG : 0;
  }
  return slopes;
}

// Horas acumuladas no ritmo simulado (velocidade do plano corrigida pelo declive).
function paceTables(route, slopes, paceOf) {
  const paceH = new Float64Array(route.count);
  const paceFootH = new Float64Array(route.count);
  for (let i = 1; i < route.count; i++) {
    const onFoot = route.onFoot[i] === 1;
    const stepKm = (distOf(route, i) - distOf(route, i - 1)) / 1000;
    const stepH = stepKm / (route.speedKmh[i] * paceOf(slopes[i], onFoot));
    paceH[i] = paceH[i - 1] + stepH;
    paceFootH[i] = paceFootH[i - 1] + (onFoot ? stepH : 0);
  }
  return { paceH, paceFootH };
}

// Trechos contíguos em que `test(i)` vale, como pares de índices.
function runsOf(count, test) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= count; i++) {
    const on = i < count && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  return runs;
}

// Cobertura calculada aqui, quando o plano não traz a avaliação de segurança (por exemplo, no check.mjs).
// 1 onde há visada direta até a antena do habitat, 0 onde o relevo bloqueia.
function radioCoverage(route, heightAt, antenna) {
  const mast = { ...HABITAT, antennaM: antenna.habitat };
  const radio = new Uint8Array(route.count);
  for (let i = 0; i < route.count; i += RADIO_EVERY) {
    const from = { x: route.xs[i], z: route.zs[i], antennaM: antenna.suit };
    const visible = lineOfSight(heightAt, from, mast, { stopAtBlock: true }).visible ? 1 : 0;
    radio.fill(visible, i, Math.min(i + RADIO_EVERY, route.count));
  }
  return radio;
}

// Cobertura a partir de `plan.safety.commsGaps` (src/safety.js): a mesma que o tablet mostra.
function radioFromGaps(route, gaps) {
  const radio = new Uint8Array(route.count).fill(1);
  for (const gap of gaps) {
    const from = clamp(Math.ceil(gap.fromM / STEP_M), 0, route.count);
    const to = gap.toM >= route.totalM ? route.count : clamp(Math.ceil(gap.toM / STEP_M), from, route.count);
    radio.fill(0, from, to);
  }
  return radio;
}

// Na cobertura amostrada aqui (a cada 20 m), mudança de menos de 40 m é ruído: segue o trecho anterior.
// Os trechos de `plan.safety` não passam por isto, para a rota e a leitura ao vivo não se contradizerem.
function mergeShortRuns(radio) {
  let from = 0;
  for (let i = 1; i <= radio.length; i++) {
    if (i < radio.length && radio[i] === radio[from]) continue;
    const isMiddle = from > 0 && i < radio.length;
    if (isMiddle && i - from < RADIO_MIN_RUN) radio.fill(radio[from - 1], from, i);
    from = i;
  }
  return radio;
}

function radioSegments(route, radio) {
  const segments = [];
  let from = 0;
  for (let i = 1; i <= route.count; i++) {
    if (i < route.count && radio[i] === radio[from]) continue;
    segments.push({ fromM: distOf(route, from), toM: distOf(route, Math.min(i, route.count - 1)), visible: radio[from] === 1 });
    from = i;
  }
  return segments;
}

function steepSegments(route, slopes) {
  const levelAt = (i) => slopeLevel(Math.abs(slopes[i]), limitFor(route.onFoot[i] === 1));
  return runsOf(route.count, (i) => levelAt(i) !== 'ok').map(({ from, to }) => {
    let peak = from;
    for (let i = from; i <= to; i++) if (Math.abs(slopes[i]) > Math.abs(slopes[peak])) peak = i;
    return { fromM: distOf(route, from), toM: distOf(route, to), peakDeg: slopes[peak], level: levelAt(peak) };
  });
}

function hazardSegments(route) {
  const edgeAt = (i) => hazardEdgeM(route.xs[i], route.zs[i]);
  return runsOf(route.count, (i) => edgeAt(i) < HAZARD_NEAR_M).map(({ from, to }) => {
    let closest = from;
    for (let i = from; i <= to; i++) if (edgeAt(i) < edgeAt(closest)) closest = i;
    const next = Math.min(closest + 1, route.count - 1);
    const prev = Math.max(next - 1, 0);
    return {
      fromM: distOf(route, from), toM: distOf(route, to), minEdgeM: edgeAt(closest),
      side: hazardSideOf(route.xs[prev], route.zs[prev], route.xs[next], route.zs[next]),
    };
  });
}

function turnKind(absDeg) {
  if (absDeg >= TURN.uturnDeg) return 'uturn';
  if (absDeg >= TURN.sharpDeg) return 'sharp';
  if (absDeg >= TURN.slightDeg) return 'turn';
  return 'slight';
}

function meanSlope(route, slopes, fromM, toM) {
  const from = clamp(Math.round(fromM / STEP_M), 0, route.count - 1);
  const to = clamp(Math.round(toM / STEP_M), from, route.count - 1);
  let sum = 0;
  for (let i = from; i <= to; i++) sum += slopes[i];
  return sum / (to - from + 1);
}

// Curvas: mudança de rumo entre os 30 m antes e os 30 m depois de cada ponto. Fica o pico de cada curva.
function findManeuvers(route, slopes, stops) {
  const arm = TURN.armSamples;
  const headingBetween = (a, b) => headingDeg(route.xs[b] - route.xs[a], route.zs[b] - route.zs[a]);
  const deltaAt = (i) => (i < arm || i >= route.count - arm ? 0 : angleDeltaDeg(headingBetween(i - arm, i), headingBetween(i, i + arm)));
  return runsOf(route.count, (i) => Math.abs(deltaAt(i)) >= TURN.minDeg).map(({ from, to }) => {
    let peak = from;
    for (let i = from; i <= to; i++) if (Math.abs(deltaAt(i)) > Math.abs(deltaAt(peak))) peak = i;
    const distM = distOf(route, peak);
    const deltaDeg = deltaAt(peak);
    return {
      distM,
      deltaDeg,
      kind: turnKind(Math.abs(deltaDeg)),
      side: deltaDeg >= 0 ? 'direita' : 'esquerda',
      atStop: stops.some((entry) => Math.abs(entry.distM - distM) <= TURN.stopRadiusM),
      climbDeg: meanSlope(route, slopes, distM + TURN.climbFromM, distM + TURN.climbToM),
    };
  });
}

const planPace = () => 1;

/**
 * @param {object} plan Plano de `buildPlan` ou de destino livre (`plan.isCustom`). Se trouxer
 *   `plan.safety.commsGaps`, a cobertura de rádio vem de lá.
 * @param {{ heightAt: (x: number, z: number) => number }} terrain
 * @param {{ suit: number, habitat: number }} [antenna] Alturas de antena, em metros.
 */
export function analyzePlan(plan, terrain, antenna = ANTENNA_M) {
  const route = sampleRoute(plan.path, terrain.heightAt);
  const slopes = slopesOf(route);
  const gaps = plan.safety?.commsGaps;
  const radio = gaps ? radioFromGaps(route, gaps) : mergeShortRuns(radioCoverage(route, terrain.heightAt, antenna));
  // O destino livre vem do roteador com o tempo já corrigido pelo declive: lá o ritmo é o do plano.
  const paceOf = plan.isCustom ? planPace : paceFactor;
  const { paceH, paceFootH } = paceTables(route, slopes, paceOf);
  const lastStop = plan.stops[plan.stops.length - 1];
  return Object.freeze({
    ...route,
    slopes,
    radio,
    paceOf,
    paceH,
    paceFootH,
    paceTotalH: paceH[route.count - 1],
    paceFootTotalH: paceFootH[route.count - 1],
    returnFromM: lastStop ? lastStop.distM : 0,
    radioSegments: radioSegments(route, radio),
    steepSegments: steepSegments(route, slopes),
    hazardSegments: hazardSegments(route),
    maneuvers: findManeuvers(route, slopes, plan.stops),
  });
}

/** Leitura interpolada da análise em um ponto da rota. */
export function routeAt(analysis, distM) {
  const d = clamp(distM, 0, analysis.totalM);
  const i = Math.min(Math.floor(d / STEP_M), analysis.count - 2);
  const fromM = i * STEP_M;
  const spanM = distOf(analysis, i + 1) - fromM;
  const t = spanM > 0 ? (d - fromM) / spanM : 0;
  const mix = (values) => lerp(values[i], values[i + 1], t);
  return {
    distM: d,
    x: mix(analysis.xs),
    z: mix(analysis.zs),
    y: mix(analysis.ys),
    slopeDeg: mix(analysis.slopes),
    paceH: mix(analysis.paceH),
    paceFootH: mix(analysis.paceFootH),
    speedKmh: analysis.speedKmh[i + 1],
    onFoot: analysis.onFoot[i + 1] === 1,
  };
}

/** Próxima curva à frente (uma que acabou de passar ainda vale por alguns metros). */
export function nextManeuver(analysis, distM, passedM = 8) {
  return analysis.maneuvers.find((maneuver) => maneuver.distM >= distM - passedM) ?? null;
}

/** Maior declive (com sinal) da rota nos próximos `rangeM` metros e a que distância ele está. */
export function slopeAhead(analysis, distM, rangeM) {
  const from = clamp(Math.round(distM / STEP_M), 0, analysis.count - 1);
  const to = clamp(Math.round((distM + rangeM) / STEP_M), from, analysis.count - 1);
  let peak = from;
  for (let i = from; i <= to; i++) if (Math.abs(analysis.slopes[i]) > Math.abs(analysis.slopes[peak])) peak = i;
  return { deg: analysis.slopes[peak], inM: Math.max(0, distOf(analysis, peak) - distM) };
}

const firstAhead = (segments, distM) => segments.find((segment) => segment.toM > distM) ?? null;

export const nextSteep = (analysis, distM) => firstAhead(analysis.steepSegments, distM);
export const hazardAhead = (analysis, distM) => firstAhead(analysis.hazardSegments, distM);

/** Situação do rádio na rota: se há visada aqui, há quanto tempo, e quando ela muda. */
export function radioAhead(analysis, distM) {
  const index = analysis.radioSegments.findIndex((segment) => segment.toM > distM);
  const at = index < 0 ? analysis.radioSegments.length - 1 : index;
  const current = analysis.radioSegments[at];
  const next = analysis.radioSegments[at + 1] ?? null;
  return {
    visible: current.visible,
    sinceM: Math.max(0, distM - current.fromM),
    changeInM: next ? Math.max(0, next.fromM - distM) : null,
    nextLengthM: next ? next.toM - next.fromM : 0,
  };
}
