// Matemática do globo de Marte: esfera, grade de ladrilhos do Mars Trek e área mapeada.
// Sem Three e sem DOM: roda no Node (ver globo-check.mjs).
//
// Esfera de raio 1 com y para o norte, longitude 0 em +x e leste para -z. É a orientação da
// SphereGeometry do Three com uma imagem equirretangular que começa em 180° oeste.
// Grade dos ladrilhos (a mesma de trek.js): no nível z há 2^(z+1) colunas e 2^z linhas de 256 px,
// com a linha 0 no polo norte e a coluna 0 em 180° oeste.
//
// Vista geográfica, a mesma do globo e do modelo local: `lat`/`lon` do ponto da superfície para onde
// a câmera olha, `distanceM` da câmera até ele, `headingDeg` (0 = norte para cima na tela, sentido
// horário) e `tiltDeg` (0 = olhando reto para baixo). As contas de câmera usam vetores [x, y, z] em
// metros a partir do centro do planeta, sempre em precisão dupla.

import { MARS_RADIUS_M, clamp } from './geo.js';

export const DEG = Math.PI / 180;
export const TILE_PX = 256;
// Folga, em fração de ladrilho, para uma borda que cai exatamente na divisa não puxar o vizinho.
const EDGE_EPS = 1e-9;

/** Longitude equivalente entre -180 (inclusive) e 180. */
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** @returns {{ rows: number, cols: number }} Tamanho da grade de ladrilhos no nível. */
export const tileGrid = (level) => ({ rows: 2 ** level, cols: 2 ** (level + 1) });

// Posição fracionária na grade: 0 no polo norte e em 180° oeste.
const rowAt = (lat, rows) => ((90 - lat) / 180) * rows;
const colAt = (lon, cols) => ((lon + 180) / 360) * cols;

/**
 * Ponto da esfera de raio 1 para uma latitude e longitude em graus.
 * @returns {{ x: number, y: number, z: number }}
 */
export function sphereFromGeo(lat, lon) {
  const cosLat = Math.cos(lat * DEG);
  return { x: cosLat * Math.cos(lon * DEG), y: Math.sin(lat * DEG), z: -cosLat * Math.sin(lon * DEG) };
}

/**
 * Latitude e longitude (graus, longitude entre -180 e 180) da direção de um ponto, a qualquer distância do centro.
 * @returns {{ lat: number, lon: number }}
 */
export function geoFromSphere(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (length === 0) throw new Error('O centro da esfera não tem latitude nem longitude.');
  return { lat: Math.asin(clamp(y / length, -1, 1)) / DEG, lon: Math.atan2(-z, x) / DEG };
}

/** Ângulo (rad), visto do centro, entre dois pontos dados em latitude e longitude. */
export function angleBetween(a, b) {
  const p = sphereFromGeo(a.lat, a.lon);
  const q = sphereFromGeo(b.lat, b.lon);
  return Math.acos(clamp(p.x * q.x + p.y * q.y + p.z * q.z, -1, 1));
}

/**
 * Ladrilho que contém o ponto.
 * @returns {{ row: number, col: number }}
 */
export function tileAt(lat, lon, level) {
  const { rows, cols } = tileGrid(level);
  return {
    row: clamp(Math.floor(rowAt(lat, rows)), 0, rows - 1),
    col: clamp(Math.floor(colAt(wrapLon(lon), cols)), 0, cols - 1),
  };
}

/** @returns {{ south: number, north: number, west: number, east: number }} Limites do ladrilho, em graus. */
export function tileBounds(level, row, col) {
  const { rows, cols } = tileGrid(level);
  return {
    north: 90 - (row / rows) * 180,
    south: 90 - ((row + 1) / rows) * 180,
    west: (col / cols) * 360 - 180,
    east: ((col + 1) / cols) * 360 - 180,
  };
}

/**
 * Ladrilhos do nível que tocam o retângulo, de norte a sul e de oeste a leste.
 * O retângulo não pode cruzar a linha de 180° (oeste menor que leste).
 * @returns {Array<{ row: number, col: number }>}
 */
export function tilesInRect({ south, north, west, east }, level) {
  const { rows, cols } = tileGrid(level);
  const row0 = clamp(Math.floor(rowAt(north, rows) + EDGE_EPS), 0, rows - 1);
  const row1 = clamp(Math.ceil(rowAt(south, rows) - EDGE_EPS) - 1, row0, rows - 1);
  const col0 = clamp(Math.floor(colAt(west, cols) + EDGE_EPS), 0, cols - 1);
  const col1 = clamp(Math.ceil(colAt(east, cols) - EDGE_EPS) - 1, col0, cols - 1);
  const tiles = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) tiles.push({ row, col });
  }
  return tiles;
}

/**
 * Bloco de `count` × `count` ladrilhos do nível, o mais centrado possível no ponto, sem sair da grade.
 * @returns {{ south: number, north: number, west: number, east: number }}
 */
export function centeredBounds(lat, lon, level, count) {
  const { rows, cols } = tileGrid(level);
  const size = Math.min(count, rows);
  const row0 = clamp(Math.round(rowAt(lat, rows) - size / 2), 0, rows - size);
  const col0 = clamp(Math.round(colAt(wrapLon(lon), cols) - size / 2), 0, cols - size);
  const first = tileBounds(level, row0, col0);
  const last = tileBounds(level, row0 + size - 1, col0 + size - 1);
  return { north: first.north, west: first.west, south: last.south, east: last.east };
}

/** O ponto está dentro da área mapeada (bordas incluídas)? */
export function isInsideArea(lat, lon, area) {
  const wrapped = wrapLon(lon);
  return lat >= area.south && lat <= area.north && wrapped >= area.west && wrapped <= area.east;
}

/** @returns {{ lat: number, lon: number }} Centro do retângulo. */
export const areaCenter = (area) => ({ lat: (area.south + area.north) / 2, lon: (area.west + area.east) / 2 });

/**
 * Primeiro nível de ladrilho que dá ao menos um ponto da imagem por pixel no centro da vista.
 * @param {number} altitude Altura da câmera sobre a superfície, em raios do planeta.
 * @param {number} fovRad Campo de visão vertical.
 * @param {number} viewportPx Altura da tela em pixels do aparelho.
 */
export function levelForView(altitude, fovRad, viewportPx) {
  const pixelRad = (2 * altitude * Math.tan(fovRad / 2)) / viewportPx;
  return Math.max(0, Math.ceil(Math.log2(Math.PI / (TILE_PX * pixelRad))));
}

/**
 * Ângulo (rad), visto do centro, entre o ponto sob a câmera e o ponto do chão que ela enxerga a
 * `offNadirRad` da vertical. Quando a linha de visada passa por fora do planeta, vale o horizonte.
 * @param {number} altitude Altura da câmera sobre a superfície, em raios do planeta.
 */
export function groundAngle(altitude, offNadirRad) {
  const reach = (1 + altitude) * Math.sin(offNadirRad);
  if (reach >= 1 || offNadirRad >= Math.PI / 2) return Math.acos(1 / (1 + altitude));
  return Math.asin(reach) - offNadirRad;
}

/** Produto escalar de dois vetores [x, y, z]. */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// a × ka + b × kb
const blend = (a, ka, b, kb) => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];

/**
 * Eixos leste, norte e para cima num ponto da superfície (vetores unitários no referencial do planeta).
 * @returns {{ east: number[], north: number[], up: number[] }}
 */
export function enuAxes(lat, lon) {
  const sinLat = Math.sin(lat * DEG);
  const cosLat = Math.cos(lat * DEG);
  const sinLon = Math.sin(lon * DEG);
  const cosLon = Math.cos(lon * DEG);
  return {
    east: [-sinLon, 0, -cosLon],
    north: [-sinLat * cosLon, cosLat, sinLat * sinLon],
    up: [cosLat * cosLon, sinLat, -cosLat * sinLon],
  };
}

/**
 * Câmera de uma vista geográfica: posição em metros a partir do centro do planeta e os eixos da
 * tela (direita, para cima e para trás) como vetores unitários.
 * @param {{ lat: number, lon: number, distanceM: number, headingDeg?: number, tiltDeg?: number }} view
 * @returns {{ position: number[], right: number[], up: number[], back: number[] }}
 */
export function poseFromView({ lat, lon, distanceM, headingDeg = 0, tiltDeg = 0 }) {
  const { east, north, up } = enuAxes(lat, lon);
  // Direção do chão que fica para cima na tela.
  const ahead = blend(north, Math.cos(headingDeg * DEG), east, Math.sin(headingDeg * DEG));
  const back = blend(up, Math.cos(tiltDeg * DEG), ahead, -Math.sin(tiltDeg * DEG));
  const screenUp = blend(ahead, Math.cos(tiltDeg * DEG), up, Math.sin(tiltDeg * DEG));
  return {
    position: blend(up, MARS_RADIUS_M, back, distanceM),
    right: cross(screenUp, back),
    up: screenUp,
    back,
  };
}

/**
 * Onde um ponto (metros a partir do centro do planeta) cai na tela: x e y de -1 a 1, com y para cima.
 * @param {number} tanHalfFov Tangente de metade do campo de visão vertical.
 * @returns {{ x: number, y: number, inFront: boolean }}
 */
export function projectPoint(pose, point, tanHalfFov, aspect) {
  const offset = blend(point, 1, pose.position, -1);
  const depth = -dot(offset, pose.back);
  return {
    x: dot(offset, pose.right) / (depth * tanHalfFov * aspect),
    y: dot(offset, pose.up) / (depth * tanHalfFov),
    inFront: depth > 0,
  };
}

/**
 * Ponto da superfície sob um ponto da tela (x e y de -1 a 1).
 * @returns {{ x: number, y: number, z: number } | null} Direção a partir do centro (raio 1), ou null se a visada passa por fora do planeta.
 */
export function surfaceUnder(pose, ndcX, ndcY, tanHalfFov, aspect) {
  const toward = blend(blend(pose.right, ndcX * tanHalfFov * aspect, pose.up, ndcY * tanHalfFov), 1, pose.back, -1);
  const ray = blend(toward, 1 / Math.hypot(...toward), toward, 0);
  const along = -dot(pose.position, ray);
  const outside = dot(pose.position, pose.position) - MARS_RADIUS_M ** 2;
  const reach = along * along - outside;
  if (along <= 0 || reach < 0) return null;
  // Forma estável da menor raiz: não subtrai dois números quase iguais quando a câmera está rente ao chão.
  const hit = blend(pose.position, 1, ray, outside / (along + Math.sqrt(reach)));
  const length = Math.hypot(...hit);
  return { x: hit[0] / length, y: hit[1] / length, z: hit[2] / length };
}
