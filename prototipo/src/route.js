// Monta o plano da saída (ida pelas paradas + retorno ao habitat) a partir das
// rotas pré-calculadas, e amostra posição, rumo e declive ao longo do caminho.

import { ROUTES, STOPS, SPEED_KMH, STOP_HOURS } from '../data/travessia.js';
import { toLocal, toGeo, headingDeg, clamp, lerp } from './geo.js';

const BASE_STOP_COUNT = 3;
const EXTENDED_STOP_COUNT = 5;
const DUPLICATE_POINT_M = 0.01;
const HEADING_LOOKAHEAD_M = 25;
const SLOPE_WINDOW_M = 30;
const RAD_TO_DEG = 180 / Math.PI;

export function buildPlan(mode, includeExtension) {
  const source = ROUTES[mode];
  if (!source) throw new Error(`Modo de deslocamento desconhecido: ${mode}`);

  const stopCount = includeExtension ? EXTENDED_STOP_COUNT : BASE_STOP_COUNT;
  const legs = source.legs.slice(0, stopCount);
  const returnLeg = includeExtension ? source.return_ext : source.return_base;
  return assemblePlan(mode, includeExtension, legs, returnLeg, false);
}

/**
 * Plano a partir de trechos calculados na hora (rota livre). Mesmo formato de `buildPlan`.
 * As paradas escolhidas precisam estar registradas com `registerStop`.
 */
export function buildPlanFromLegs(mode, legs, returnLeg) {
  if (!SPEED_KMH[mode]) throw new Error(`Modo de deslocamento desconhecido: ${mode}`);
  return assemblePlan(mode, false, legs, returnLeg, true);
}

function assemblePlan(mode, includeExtension, legs, returnLeg, isCustom) {
  const path = buildPath([...legs, returnLeg], mode);
  const stops = legs.map((leg, index) => ({
    stop: findStop(leg.to),
    distM: path.legEnds[index],
  }));

  return Object.freeze({
    mode,
    includeExtension,
    isCustom,
    stopCount: legs.length,
    legs,
    returnLeg,
    path,
    stops,
    stats: computeStats(legs, returnLeg, path, legs.length),
  });
}

// Paradas criadas em tempo de uso (os pontos escolhidos no mapa), além das dos dados.
const customStops = new Map();

/** @param {{ id: string, name: string, lat: number, lon: number, el: number }} stop */
export function registerStop(stop) {
  customStops.set(stop.id, stop);
}

export function findStop(id) {
  const stop = STOPS.find((candidate) => candidate.id === id) ?? customStops.get(id);
  if (!stop) throw new Error(`Parada desconhecida: ${id}`);
  return stop;
}

/**
 * Trecho no formato dos dados (coords em lat/lon e perfil de altitude) a partir de pontos locais.
 * @param {Array<{ x: number, z: number, elev: number }>} points
 * @param {number} maxSlopeDeg Maior declive do terreno ao longo do trecho.
 * @param {number} hours Tempo de deslocamento calculado pelo roteador (com o efeito do declive).
 */
export function legFromPoints(from, to, points, maxSlopeDeg, hours) {
  let lengthM = 0;
  let gainM = 0;
  let lossM = 0;
  for (let i = 1; i < points.length; i++) {
    lengthM += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const rise = points[i].elev - points[i - 1].elev;
    if (rise > 0) gainM += rise;
    else lossM -= rise;
  }
  return Object.freeze({
    from,
    to,
    coords: points.map(({ x, z }) => { const { lat, lon } = toGeo(x, z); return [lat, lon]; }),
    profile: points.map((point) => Math.round(point.elev)),
    len_km: lengthM / 1000,
    gain_m: Math.round(gainM),
    loss_m: Math.round(lossM),
    max_slope: Math.round(maxSlopeDeg * 10) / 10,
    blocked: false,
    hours,
  });
}

// Nome curto da parada, sem o complemento depois de " ·".
export const shortName = (id) => findStop(id).name.split(' ·')[0];

// O tempo vem do caminho montado, então já conta os trechos bloqueados feitos a pé
// e bate com o que o visor mostra ao fim da rota.
function computeStats(legs, returnLeg, path, stopCount) {
  const outKm = legs.reduce((sum, leg) => sum + leg.len_km, 0);
  return Object.freeze({
    outKm,
    totalKm: outKm + returnLeg.len_km,
    gainM: legs.reduce((sum, leg) => sum + leg.gain_m, 0),
    maxSlopeDeg: Math.max(...legs.map((leg) => leg.max_slope)),
    blockedLegs: legs.filter((leg) => leg.blocked),
    hours: path.totalTravelH + stopCount * STOP_HOURS,
  });
}

function polylineLengthM(points) {
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    meters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return meters;
}

// Junta os trechos em uma única polilinha com distância e tempo acumulados.
// Trecho bloqueado para veículo é percorrido a pé. `footH` é o tempo fora da
// cabine (no modo a pé, o tempo todo), usado para o consumo do traje.
function buildPath(legs, mode) {
  const points = [];
  const legEnds = [];
  let distM = 0;
  let travelH = 0;
  let footH = 0;

  legs.forEach((leg, legIndex) => {
    const onFoot = mode === 'walk' || leg.blocked;
    const flatKmh = onFoot ? SPEED_KMH.walk : SPEED_KMH[mode];
    // Trecho vindo do roteador traz o tempo com o efeito do declive: a velocidade média sai dele,
    // para o relógio e o oxigênio do plano baterem com o que a rota realmente custa.
    const speedKmh = leg.hours > 0 ? leg.len_km / leg.hours : flatKmh;
    const local = leg.coords.map(([lat, lon]) => toLocal(lat, lon));
    // As coords são a rota decimada, de 3% a 8% mais curta que o len_km medido na grade.
    // A escala faz a distância percorrida fechar com o len_km do dado.
    const rawM = polylineLengthM(local);
    const scale = rawM > 0 ? (leg.len_km * 1000) / rawM : 1;
    local.forEach(({ x, z }, i) => {
      const prev = points[points.length - 1];
      if (prev) {
        const rawStepM = Math.hypot(x - prev.x, z - prev.z);
        if (rawStepM < DUPLICATE_POINT_M) return;
        const stepM = rawStepM * scale;
        const stepH = stepM / 1000 / speedKmh;
        distM += stepM;
        travelH += stepH;
        if (onFoot) footH += stepH;
      }
      points.push({ x, z, elev: leg.profile[i], distM, travelH, footH, legIndex, speedKmh, onFoot });
    });
    legEnds.push(distM);
  });

  return Object.freeze({ points, legEnds, totalM: distM, totalTravelH: travelH, totalFootH: footH });
}

export function samplePath(path, distM) {
  const { points } = path;
  const d = clamp(distM, 0, path.totalM);
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distM <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.distM - a.distM;
  const t = span > 0 ? (d - a.distM) / span : 0;
  return {
    distM: d,
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    elev: lerp(a.elev, b.elev, t),
    travelH: lerp(a.travelH, b.travelH, t),
    footH: lerp(a.footH, b.footH, t),
    legIndex: b.legIndex,
    speedKmh: b.speedKmh,
    onFoot: b.onFoot,
  };
}

// Rumo olhando alguns metros à frente, para a câmera não tremer nos vértices.
export function headingAt(path, distM) {
  const aheadM = Math.min(distM + HEADING_LOOKAHEAD_M, path.totalM);
  const from = samplePath(path, aheadM - HEADING_LOOKAHEAD_M);
  const to = samplePath(path, aheadM);
  return headingDeg(to.x - from.x, to.z - from.z);
}

// Declive em graus (positivo = subida), lido do perfil real numa janela curta.
export function slopeDegAt(path, distM) {
  const from = samplePath(path, distM - SLOPE_WINDOW_M / 2);
  const to = samplePath(path, distM + SLOPE_WINDOW_M / 2);
  const runM = to.distM - from.distM;
  if (runM <= 0) return 0;
  return Math.atan((to.elev - from.elev) / runM) * RAD_TO_DEG;
}

// Maior declive (em módulo) no trecho logo à frente.
export function maxSlopeAheadDeg(path, distM, rangeM, stepM) {
  let max = 0;
  for (let offset = 0; offset <= rangeM; offset += stepM) {
    max = Math.max(max, Math.abs(slopeDegAt(path, distM + offset)));
  }
  return max;
}
