// Campo de altitude do protótipo.
//
// Fonte principal: a grade real extraída do modelo de elevação do Gale (USGS, 1 m),
// carregada de assets/elevation (ver tools/extrair-dem.mjs).
//
// Reserva, se o arquivo faltar: um relevo APROXIMADO, que respeita as altitudes reais
// ao longo do trajeto do Curiosity e das rotas e preenche o resto com tendência e ruído.

import { TRACK, ROUTES } from '../data/travessia.js';
import { toLocal, elevToY, yToElev, clamp } from './geo.js';
import { fbm, ridged } from './noise.js';
import { SUN_DIRECTION } from './config.js';

// Janela do terreno em torno da origem local. `cellM` vale para o relevo aproximado;
// a grade real traz o próprio tamanho de célula.
export const FIELD = Object.freeze({ halfWidth: 3200, halfDepth: 4200, cellM: 16 });
const COLS = (FIELD.halfWidth * 2) / FIELD.cellM;
const ROWS = (FIELD.halfDepth * 2) / FIELD.cellM;
const STRIDE = COLS + 1;

const ANCHOR_CELL_M = 40;
const REACH_M = 700;
const SOFTEN_M = 25;
const CONFIDENCE_FALLOFF_M = 260;
const HILL_DAMPING_NEAR_ANCHORS = 0.92;
const ELEV_LIMITS = Object.freeze({ min: -4350, max: -3300 });
const BUCKET_OFFSET = 100;
const BUCKET_KEY_BASE = 1000;
const RAD_TO_DEG = 180 / Math.PI;

const RADIATION_BASE_USV_H = 27;
const REFERENCE_ELEV_M = -4144;

function collectSamples() {
  const samples = TRACK.map(([lat, lon, elev]) => ({ ...toLocal(lat, lon), elev }));
  for (const mode of ['walk', 'car']) {
    const source = ROUTES[mode];
    for (const leg of [...source.legs, source.return_base, source.return_ext]) {
      leg.coords.forEach(([lat, lon], i) => samples.push({ ...toLocal(lat, lon), elev: leg.profile[i] }));
    }
  }
  return samples;
}

// Uma âncora por célula de 40 m, com a média das amostras que caem nela.
function thinAnchors(samples) {
  const cells = new Map();
  for (const sample of samples) {
    const key = `${Math.floor(sample.x / ANCHOR_CELL_M)},${Math.floor(sample.z / ANCHOR_CELL_M)}`;
    const cell = cells.get(key) ?? { x: 0, z: 0, elev: 0, count: 0 };
    cells.set(key, { x: cell.x + sample.x, z: cell.z + sample.z, elev: cell.elev + sample.elev, count: cell.count + 1 });
  }
  return [...cells.values()].map((cell) => ({ x: cell.x / cell.count, z: cell.z / cell.count, elev: cell.elev / cell.count }));
}

const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

// Mínimos quadrados de elev = a + b*x + c*z (o Monte Sharp sobe para o sul).
function fitPlane(anchors) {
  const sums = { n: 0, x: 0, z: 0, xx: 0, zz: 0, xz: 0, e: 0, xe: 0, ze: 0 };
  for (const { x, z, elev } of anchors) {
    sums.n += 1; sums.x += x; sums.z += z;
    sums.xx += x * x; sums.zz += z * z; sums.xz += x * z;
    sums.e += elev; sums.xe += x * elev; sums.ze += z * elev;
  }
  const matrix = [[sums.n, sums.x, sums.z], [sums.x, sums.xx, sums.xz], [sums.z, sums.xz, sums.zz]];
  const rhs = [sums.e, sums.xe, sums.ze];
  const det = det3(matrix);
  if (Math.abs(det) < Number.EPSILON) throw new Error('Não foi possível ajustar a tendência do relevo.');
  const solve = (column) => det3(matrix.map((row, r) => row.map((value, c) => (c === column ? rhs[r] : value)))) / det;
  return { a: solve(0), b: solve(1), c: solve(2) };
}

const planeElev = (plane, x, z) => clamp(plane.a + plane.b * x + plane.c * z, ELEV_LIMITS.min, ELEV_LIMITS.max);
const bucketKey = (bx, bz) => (bx + BUCKET_OFFSET) * BUCKET_KEY_BASE + (bz + BUCKET_OFFSET);

function bucketAnchors(anchors) {
  const buckets = new Map();
  for (const anchor of anchors) {
    const key = bucketKey(Math.floor(anchor.x / REACH_M), Math.floor(anchor.z / REACH_M));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(anchor);
  }
  return buckets;
}

// Resíduo interpolado das âncoras próximas e o quanto confiar nele (0 a 1).
function anchorInfluence(buckets, x, z) {
  const bx = Math.floor(x / REACH_M);
  const bz = Math.floor(z / REACH_M);
  let weightSum = 0;
  let residualSum = 0;
  let nearest = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = buckets.get(bucketKey(bx + dx, bz + dz));
      if (!bucket) continue;
      for (const anchor of bucket) {
        const dist = Math.hypot(x - anchor.x, z - anchor.z);
        if (dist >= REACH_M) continue;
        const fade = 1 - dist / REACH_M;
        const weight = (fade * fade) / (dist * dist + SOFTEN_M * SOFTEN_M);
        weightSum += weight;
        residualSum += weight * anchor.residual;
        nearest = Math.min(nearest, dist);
      }
    }
  }
  if (weightSum === 0) return { residual: 0, confidence: 0 };
  return { residual: residualSum / weightSum, confidence: Math.exp(-((nearest / CONFIDENCE_FALLOFF_M) ** 2)) };
}

// Morros inventados, de propósito baixos: com a foto real por cima, relevo falso alto
// criaria sombras onde a imagem mostra terreno plano.
const hills = (x, z) => (ridged(x / 900, z / 900, 4, 11) - 0.5) * 30 + (fbm(x / 260, z / 260, 3, 23) - 0.5) * 10;
const grain = (x, z) => (fbm(x / 22, z / 22, 3, 37) - 0.5) * 1.6;

function elevationAt(plane, buckets, x, z) {
  const { residual, confidence } = anchorInfluence(buckets, x, z);
  const hillWeight = 1 - HILL_DAMPING_NEAR_ANCHORS * confidence;
  return planeElev(plane, x, z) + confidence * residual + hillWeight * hills(x, z) + grain(x, z);
}

function gradients(heights, cols, rows, cellM) {
  const stride = cols + 1;
  const gradX = new Float32Array(heights.length);
  const gradZ = new Float32Array(heights.length);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const west = heights[r * stride + Math.max(c - 1, 0)];
      const east = heights[r * stride + Math.min(c + 1, cols)];
      const north = heights[Math.max(r - 1, 0) * stride + c];
      const south = heights[Math.min(r + 1, rows) * stride + c];
      gradX[r * stride + c] = (east - west) / (2 * cellM);
      gradZ[r * stride + c] = (south - north) / (2 * cellM);
    }
  }
  return { gradX, gradZ };
}

// `cols` e `rows` contam células; a grade tem um nó a mais em cada direção.
function makeField(heights, cols, rows, cellM, isReal) {
  return Object.freeze({
    cols,
    rows,
    stride: cols + 1,
    cellM,
    halfWidth: FIELD.halfWidth,
    halfDepth: FIELD.halfDepth,
    isReal,
    heights,
    ...gradients(heights, cols, rows, cellM),
  });
}

/**
 * Campo a partir da grade real (assets/elevation). Recusa arquivo que não bate com a janela do terreno.
 * @param {{ cols: number, rows: number, cellM: number, halfWidthM: number, halfDepthM: number, elevMinM: number, elevStepM: number }} meta
 * @param {Uint16Array} packed
 */
export function fieldFromElevation(meta, packed) {
  const numbers = [meta.cols, meta.rows, meta.cellM, meta.elevMinM, meta.elevStepM];
  if (!numbers.every(Number.isFinite) || meta.cellM <= 0) throw new Error('Descrição da grade de altitude inválida.');
  if (meta.halfWidthM !== FIELD.halfWidth || meta.halfDepthM !== FIELD.halfDepth) {
    throw new Error('A grade de altitude cobre uma janela diferente da do terreno.');
  }
  const cols = meta.cols - 1;
  const rows = meta.rows - 1;
  if (cols * meta.cellM !== FIELD.halfWidth * 2 || rows * meta.cellM !== FIELD.halfDepth * 2) {
    throw new Error('O tamanho da grade de altitude não fecha com a janela do terreno.');
  }
  if (packed.length !== meta.cols * meta.rows) throw new Error('Arquivo de altitude com tamanho inesperado.');
  const heights = Float32Array.from(packed, (value) => elevToY(meta.elevMinM + value * meta.elevStepM));
  return makeField(heights, cols, rows, meta.cellM, true);
}

export function buildHeightField() {
  const anchors = thinAnchors(collectSamples());
  const plane = fitPlane(anchors);
  const buckets = bucketAnchors(anchors.map((anchor) => ({ ...anchor, residual: anchor.elev - planeElev(plane, anchor.x, anchor.z) })));
  const heights = new Float32Array((ROWS + 1) * STRIDE);
  for (let r = 0; r <= ROWS; r++) {
    const z = -FIELD.halfDepth + r * FIELD.cellM;
    for (let c = 0; c <= COLS; c++) {
      const x = -FIELD.halfWidth + c * FIELD.cellM;
      heights[r * STRIDE + c] = elevToY(elevationAt(plane, buckets, x, z));
    }
  }
  return makeField(heights, COLS, ROWS, FIELD.cellM, false);
}

function cellAt(field, x, z) {
  const gx = clamp((x + field.halfWidth) / field.cellM, 0, field.cols);
  const gz = clamp((z + field.halfDepth) / field.cellM, 0, field.rows);
  const col = Math.min(Math.floor(gx), field.cols - 1);
  const row = Math.min(Math.floor(gz), field.rows - 1);
  return { index: row * field.stride + col, tx: gx - col, tz: gz - row };
}

// Altura y da superfície, igual à da malha (cada célula são dois triângulos).
export function heightAt(field, x, z) {
  const { index, tx, tz } = cellAt(field, x, z);
  const { heights, stride } = field;
  const a = heights[index];
  const b = heights[index + 1];
  const d = heights[index + stride];
  const e = heights[index + stride + 1];
  if (tx + tz <= 1) return a + (b - a) * tx + (d - a) * tz;
  return e + (d - e) * (1 - tx) + (b - e) * (1 - tz);
}

export const slopeDegOf = (gradX, gradZ) => Math.atan(Math.hypot(gradX, gradZ)) * RAD_TO_DEG;

// Quanto a superfície está virada para o sol (0 a 1).
export function sunFacingOf(gradX, gradZ) {
  const length = Math.hypot(gradX, 1, gradZ);
  const dot = (-gradX * SUN_DIRECTION[0] + SUN_DIRECTION[1] - gradZ * SUN_DIRECTION[2]) / length;
  return Math.max(0, dot);
}

// Camadas SIMULADAS (não são dados de missão): servem só para validar a interface.
export function simulatedRadiation(slopeDeg, x, z) {
  const shielding = clamp(slopeDeg / 25, 0, 1) * 0.6 + fbm(x / 500, z / 500, 2, 91) * 0.4;
  return RADIATION_BASE_USV_H * (1.06 - 0.16 * shielding);
}

export function simulatedGroundTemp(sunFacing, elevM, x, z) {
  const altitudeCooling = 0.9 * ((elevM - REFERENCE_ELEV_M) / 100);
  return -24 + 20 * sunFacing - altitudeCooling + 5 * (fbm(x / 300, z / 300, 2, 63) - 0.5);
}

// Leitura completa em um ponto: altura, declive e as camadas simuladas.
export function probe(field, x, z) {
  const { index, tx, tz } = cellAt(field, x, z);
  const nearest = index + (tx > 0.5 ? 1 : 0) + (tz > 0.5 ? field.stride : 0);
  const gradX = field.gradX[nearest];
  const gradZ = field.gradZ[nearest];
  const y = heightAt(field, x, z);
  const slopeDeg = slopeDegOf(gradX, gradZ);
  return {
    y,
    slopeDeg,
    radiation: simulatedRadiation(slopeDeg, x, z),
    groundTemp: simulatedGroundTemp(sunFacingOf(gradX, gradZ), yToElev(y), x, z),
  };
}
