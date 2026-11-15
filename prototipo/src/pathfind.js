// Rota de menor custo sobre a grade de altitude. Puro: roda no Node e no navegador.
//
// O custo de cada passo é o tempo de deslocamento. A velocidade cai com o declive
// seguindo a função de caminhada de Tobler (1993), W = 6·exp(-3,5·|S + 0,05|) km/h,
// usada aqui só como fator relativo sobre a velocidade em terreno plano de cada modo.
// Referência: Tobler, W. (1993), "Three presentations on geographical analysis and
// modeling", NCGIA Technical Report 93-1.
//
// Limite: a grade tem células de 8 m, então blocos e cristas menores que isso não
// aparecem. As rotas servem para planejar, não para substituir a leitura do terreno.

import { HAZARD, SPEED_KMH } from '../data/travessia.js';
import { toLocal, yToElev, clamp } from './geo.js';
import { heightAt } from './heightfield.js';

const TOBLER_K = 3.5;
const TOBLER_OFFSET = 0.05;
const TOBLER_FLAT = Math.exp(-TOBLER_K * TOBLER_OFFSET);
const MAX_RELATIVE_SPEED = 1 / TOBLER_FLAT;
// Peso extra perto do limite de declive: a rota prefere dar a volta a encarar uma encosta no limite.
const SLOPE_PENALTY = 4;
const SNAP_RADIUS_CELLS = 12;
const FIELD_LOOKUP_RADIUS = 4;
const SMOOTH_RADIUS = 2;
const INITIAL_HEAP = 1 << 16;
const DEG = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
// Vizinhos em pares (coluna, linha): quatro retos e quatro diagonais.
const NEIGHBORS = Int8Array.of(1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1);

// Limites de declive do artifact original: 20° a pé, 15° de veículo.
// Nas rochas cortantes, quem vai a pé anda devagar; o veículo não entra.
// Na areia escura (estimada, ver areia.js) a rota custa mais caro: a pé cansa, e de veículo há risco de
// atolar, como aconteceu com o Spirit. Os fatores são hipótese da equipe; não é proibido cruzar, porque
// um destino pode ficar do outro lado.
export const TRAVEL = Object.freeze({
  walk: Object.freeze({ speedKmh: SPEED_KMH.walk, maxSlopeDeg: 20, hazardFactor: 3, sandFactor: 2.5 }),
  car: Object.freeze({ speedKmh: SPEED_KMH.car, maxSlopeDeg: 15, hazardFactor: Infinity, sandFactor: 8 }),
});

// Fila de prioridade mínima sobre vetores tipados (cresce quando enche).
function createHeap() {
  let keys = new Float64Array(INITIAL_HEAP);
  let values = new Int32Array(INITIAL_HEAP);
  let size = 0;
  const grow = () => {
    const nextKeys = new Float64Array(keys.length * 2);
    const nextValues = new Int32Array(values.length * 2);
    nextKeys.set(keys);
    nextValues.set(values);
    keys = nextKeys;
    values = nextValues;
  };
  return {
    isEmpty: () => size === 0,
    push(key, value) {
      if (size === keys.length) grow();
      let i = size++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[parent] <= key) break;
        keys[i] = keys[parent];
        values[i] = values[parent];
        i = parent;
      }
      keys[i] = key;
      values[i] = value;
    },
    pop() {
      const top = values[0];
      size -= 1;
      const key = keys[size];
      const value = values[size];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[child + 1] < keys[child]) child += 1;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
      return top;
    },
  };
}

function polylineStats(points) {
  let lengthM = 0;
  let gainM = 0;
  let lossM = 0;
  for (let i = 1; i < points.length; i++) {
    lengthM += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const rise = points[i].elev - points[i - 1].elev;
    if (rise > 0) gainM += rise;
    else lossM -= rise;
  }
  return { lengthM, gainM, lossM };
}

/**
 * @param {object} field Campo de altitude de heightfield.js.
 */
/**
 * @param {object} field Campo de altitude do relevo.
 * @param {{ sand?: Uint8Array | null }} [options] `sand`: 1 nas células com areia escura estimada.
 */
export function createRouter(field, { sand = null } = {}) {
  const { cols, rows, stride, cellM, heights, gradX, gradZ, halfWidth, halfDepth } = field;
  const count = heights.length;
  const slopeDeg = Float32Array.from(gradX, (gx, i) => Math.atan(Math.hypot(gx, gradZ[i])) * RAD_TO_DEG);

  const hazard = { ...toLocal(HAZARD.lat, HAZARD.lon), radiusM: HAZARD.radiusKm * 1000 };
  const inHazard = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const row = (i / stride) | 0;
    const x = -halfWidth + (i - row * stride) * cellM;
    const z = -halfDepth + row * cellM;
    inHazard[i] = Math.hypot(x - hazard.x, z - hazard.z) <= hazard.radiusM ? 1 : 0;
  }

  const xzOf = (index) => {
    const row = (index / stride) | 0;
    return { x: -halfWidth + (index - row * stride) * cellM, z: -halfDepth + row * cellM };
  };

  // Nó da grade mais próximo, alinhado ao passo (1 = 8 m, 2 = 16 m...).
  function nodeAt(x, z, step = 1) {
    const col = clamp(Math.round((x + halfWidth) / cellM / step) * step, 0, cols);
    const row = clamp(Math.round((z + halfDepth) / cellM / step) * step, 0, rows);
    return row * stride + col;
  }

  // Multiplicador de custo por nó: sobe perto do limite de declive; infinito = intransitável.
  function buildPenalty(profile) {
    const slopeWeight = profile.slopeWeight ?? SLOPE_PENALTY;
    const penalty = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const slope = slopeDeg[i];
      if (slope > profile.maxSlopeDeg) { penalty[i] = Infinity; continue; }
      let value = 1 + slopeWeight * (slope / profile.maxSlopeDeg) ** 2;
      if (inHazard[i]) value *= profile.hazardFactor;
      if (sand?.[i]) value *= profile.sandFactor ?? 1;
      if (profile.extraCost) value *= profile.extraCost[i];
      penalty[i] = value;
    }
    return penalty;
  }

  // Se o ponto cai em nó intransitável, procura o transitável mais próximo.
  function snap(index, penalty, step) {
    if (Number.isFinite(penalty[index])) return index;
    const row = (index / stride) | 0;
    const col = index - row * stride;
    let best = -1;
    let bestDist = Infinity;
    for (let dr = -SNAP_RADIUS_CELLS; dr <= SNAP_RADIUS_CELLS; dr++) {
      for (let dc = -SNAP_RADIUS_CELLS; dc <= SNAP_RADIUS_CELLS; dc++) {
        const r = row + dr * step;
        const c = col + dc * step;
        if (r < 0 || r > rows || c < 0 || c > cols) continue;
        const candidate = r * stride + c;
        const dist = dr * dr + dc * dc;
        if (dist < bestDist && Number.isFinite(penalty[candidate])) { best = candidate; bestDist = dist; }
      }
    }
    return best;
  }

  /**
   * Busca de menor custo. Com `goal` é um A*; sem ele, preenche o custo de todos os nós alcançáveis.
   * `reverse` calcula o custo de CHEGAR à origem (útil para "tempo de volta até o habitat").
   */
  function search({ start, goal = -1, profile, penalty, step = 1, reverse = false }) {
    // `cost` decide a rota (tempo vezes as penalidades); `hours` guarda só o tempo de deslocamento.
    const cost = new Float32Array(count).fill(Infinity);
    const hours = new Float32Array(count);
    const previous = new Int32Array(count).fill(-1);
    const closed = new Uint8Array(count);
    const heap = createHeap();
    const maxGrade = Math.tan(profile.maxSlopeDeg * DEG);
    const topSpeedKmh = profile.speedKmh * MAX_RELATIVE_SPEED;
    const goalXZ = goal >= 0 ? xzOf(goal) : null;
    const estimate = (index) => {
      if (!goalXZ) return 0;
      const { x, z } = xzOf(index);
      return Math.hypot(x - goalXZ.x, z - goalXZ.z) / 1000 / topSpeedKmh;
    };

    cost[start] = 0;
    heap.push(estimate(start), start);
    while (!heap.isEmpty()) {
      const node = heap.pop();
      if (closed[node]) continue;
      closed[node] = 1;
      if (node === goal) break;
      const row = (node / stride) | 0;
      const col = node - row * stride;
      for (let n = 0; n < NEIGHBORS.length; n += 2) {
        const c = col + NEIGHBORS[n] * step;
        const r = row + NEIGHBORS[n + 1] * step;
        if (c < 0 || c > cols || r < 0 || r > rows) continue;
        const next = r * stride + c;
        if (closed[next] || !Number.isFinite(penalty[next])) continue;
        const runM = cellM * step * (NEIGHBORS[n] !== 0 && NEIGHBORS[n + 1] !== 0 ? Math.SQRT2 : 1);
        const rise = reverse ? heights[node] - heights[next] : heights[next] - heights[node];
        const grade = rise / runM;
        if (Math.abs(grade) > maxGrade) continue;
        const relativeSpeed = Math.exp(-TOBLER_K * Math.abs(grade + TOBLER_OFFSET)) / TOBLER_FLAT;
        const stepHours = Math.hypot(runM, rise) / 1000 / (profile.speedKmh * relativeSpeed);
        const total = cost[node] + stepHours * penalty[next];
        if (total < cost[next]) {
          cost[next] = total;
          hours[next] = hours[node] + stepHours;
          previous[next] = node;
          heap.push(total + estimate(next), next);
        }
      }
    }
    return { cost, hours, previous };
  }

  // Tira o serrilhado da rota em grade com uma média móvel, mantendo as pontas.
  // Se o ponto suavizado cair em terreno intransitável, fica o nó original.
  function smooth(nodes, penalty) {
    const raw = nodes.map(xzOf);
    return raw.map((point, i) => {
      if (i === 0 || i === raw.length - 1) return point;
      const from = Math.max(0, i - SMOOTH_RADIUS);
      const to = Math.min(raw.length - 1, i + SMOOTH_RADIUS);
      let x = 0;
      let z = 0;
      for (let k = from; k <= to; k++) { x += raw[k].x; z += raw[k].z; }
      const smoothed = { x: x / (to - from + 1), z: z / (to - from + 1) };
      return Number.isFinite(penalty[nodeAt(smoothed.x, smoothed.z)]) ? smoothed : point;
    });
  }

  /**
   * Melhor rota entre dois pontos para um perfil de deslocamento.
   * @returns {{ reachable: boolean, points: Array<{x:number,z:number,elev:number}>, hours: number, lengthM: number, gainM: number, lossM: number, maxSlopeDeg: number }}
   */
  function findPath(from, to, profile) {
    const penalty = buildPenalty(profile);
    const start = snap(nodeAt(from.x, from.z), penalty, 1);
    const goal = snap(nodeAt(to.x, to.z), penalty, 1);
    const unreachable = { reachable: false, points: [], hours: Infinity, lengthM: 0, gainM: 0, lossM: 0, maxSlopeDeg: 0 };
    if (start < 0 || goal < 0) return unreachable;
    const { cost, hours, previous } = search({ start, goal, profile, penalty });
    if (!Number.isFinite(cost[goal])) return unreachable;

    const nodes = [];
    for (let node = goal; node >= 0; node = previous[node]) nodes.push(node);
    nodes.reverse();
    const points = smooth(nodes, penalty).map(({ x, z }) => ({ x, z, elev: yToElev(heightAt(field, x, z)) }));
    return {
      reachable: true,
      points,
      hours: hours[goal],
      // Declive do terreno nos pontos da rota desenhada (depois da suavização).
      maxSlopeDeg: points.reduce((max, point) => Math.max(max, slopeDeg[nodeAt(point.x, point.z)]), 0),
      ...polylineStats(points),
    };
  }

  /**
   * Tempo de deslocamento (em horas) entre a origem e cada nó da grade, no passo dado.
   * Com `reverse`, é o tempo para ir de cada nó ATÉ a origem.
   * `at(x, z)` devolve o tempo no nó mais próximo; se ele for intransitável, usa o vizinho
   * alcançável mais próximo (a rota real pode passar por uma célula que a grade marca como íngreme).
   */
  function costField({ origin, profile, step = 1, reverse = false }) {
    const penalty = buildPenalty(profile);
    const start = snap(nodeAt(origin.x, origin.z, step), penalty, step);
    if (start < 0) throw new Error('Origem do campo de custo em terreno intransitável.');
    const { cost, hours } = search({ start, profile, penalty, step, reverse });
    const at = (x, z) => {
      const index = nodeAt(x, z, step);
      if (Number.isFinite(cost[index])) return hours[index];
      const row = (index / stride) | 0;
      const col = index - row * stride;
      for (let radius = 1; radius <= FIELD_LOOKUP_RADIUS; radius++) {
        let best = Infinity;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            const r = row + dr * step;
            const c = col + dc * step;
            if (r < 0 || r > rows || c < 0 || c > cols) continue;
            const candidate = r * stride + c;
            if (Number.isFinite(cost[candidate])) best = Math.min(best, hours[candidate]);
          }
        }
        if (Number.isFinite(best)) return best;
      }
      return Infinity;
    };
    return { cost, hours, step, at };
  }

  /** Há areia escura estimada neste ponto? */
  const sandAt = (x, z) => Boolean(sand?.[nodeAt(x, z)]);

  return Object.freeze({ findPath, costField, nodeAt, xzOf, slopeDeg, count, sandAt, hasSand: Boolean(sand) });
}
