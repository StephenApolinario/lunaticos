// Malha do terreno e pintura das camadas (cores por vértice).
//
// A aparência tem dois modos:
// - com a imagem orbital real (HiRISE) como textura, depois que ela carrega;
// - procedural (cor inventada), enquanto carrega ou se a imagem não estiver disponível.

import * as THREE from 'three';
import { HAZARD } from '../data/travessia.js';
import { toLocal, toGeo, yToElev, DATA_BOUNDS, clamp } from './geo.js';
import { buildHeightField, fieldFromElevation, heightAt, probe, slopeDegOf } from './heightfield.js';
import { fbm, valueNoise, mulberry32 } from './noise.js';
import { mosaicUv, mosaicCoverage } from './tiles.js';
import { SLOPE_CLASSES, LAYERS } from './config.js';

const DETAIL_TILE_M = 18;
const DETAIL_TEXTURE_PX = 512;
const DETAIL_ANISOTROPY = 8;
const DETAIL_UV_CHANNEL = 1;
const OUTSIDE_DATA_BRIGHTNESS = 0.34;
const OUTSIDE_FADE_M = 140;
const LAYER_OPACITY = 0.78;
const SLOPE_OPACITY = 0.72;
const HAZARD_TINT_STRENGTH = 0.4;
// Sobre a foto, a cor do vértice multiplica a imagem: branco deixa a foto como ela é.
const PHOTO_WHITE = Object.freeze([1, 1, 1]);
const PHOTO_HAZARD_TINT = Object.freeze([1.15, 0.62, 0.56]);

const linear = (css) => new THREE.Color(css).toArray();
const PALETTE = Object.freeze({
  sand: linear('#b0714c'),
  rock: linear('#d0aa88'),
  darkSand: linear('#5e4636'),
  hazard: linear('#a03326'),
});
const SLOPE_COLORS = SLOPE_CLASSES.map((entry) => ({ minDeg: entry.minDeg, rgb: linear(entry.color) }));

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const SAND_LUMA = luma(PALETTE.sand);

function vertexXZ(field, index) {
  const row = Math.floor(index / field.stride);
  const col = index - row * field.stride;
  return { x: -field.halfWidth + col * field.cellM, z: -field.halfDepth + row * field.cellM };
}

// `uv` aponta para a imagem orbital; `uv1` repete a textura de grão a cada poucos metros.
function buildGeometry(field) {
  const count = field.heights.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const photoUvs = new Float32Array(count * 2);
  const detailUvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const { x, z } = vertexXZ(field, i);
    positions.set([x, field.heights[i], z], i * 3);
    const length = Math.hypot(field.gradX[i], 1, field.gradZ[i]);
    normals.set([-field.gradX[i] / length, 1 / length, -field.gradZ[i] / length], i * 3);
    const { lat, lon } = toGeo(x, z);
    const { u, v } = mosaicUv(lat, lon);
    photoUvs.set([u, v], i * 2);
    detailUvs.set([x / DETAIL_TILE_M, z / DETAIL_TILE_M], i * 2);
  }

  const indices = new Uint32Array(field.cols * field.rows * 6);
  let offset = 0;
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const a = row * field.stride + col;
      const b = a + 1;
      const d = a + field.stride;
      indices.set([a, d, b, b, d, d + 1], offset);
      offset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(photoUvs, 2));
  geometry.setAttribute('uv1', new THREE.BufferAttribute(detailUvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// Valores por vértice que não mudam: cor procedural, zona de risco e coberturas (foto e área de dados).
function computeVertexData(field, bounds) {
  const hazard = { ...toLocal(HAZARD.lat, HAZARD.lon), radiusM: HAZARD.radiusKm * 1000 };
  const count = field.heights.length;
  const baseColors = new Float32Array(count * 3);
  const hazardMask = new Float32Array(count);
  const photoCoverage = new Float32Array(count);
  const dataCover = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const { x, z } = vertexXZ(field, i);
    const slopeDeg = slopeDegOf(field.gradX[i], field.gradZ[i]);
    const rockiness = smoothstep(6, 20, slopeDeg);
    const patches = smoothstep(0.55, 0.8, fbm(x / 350, z / 350, 3, 51));
    const fine = fbm(x / 60, z / 60, 2, 77);
    const strata = Math.sin(yToElev(field.heights[i]) * 0.9 + fine * 6) * 0.05 * rockiness;

    // Areia nos planos, rocha clara nas encostas, manchas escuras.
    let rgb = mix(PALETTE.sand, PALETTE.rock, rockiness);
    rgb = mix(rgb, PALETTE.darkSand, patches * (1 - rockiness) * 0.75);
    const brightness = 1 + strata + (fine - 0.5) * 0.14;
    baseColors.set(rgb.map((channel) => channel * brightness), i * 3);

    hazardMask[i] = smoothstep(hazard.radiusM, hazard.radiusM * 0.85, Math.hypot(x - hazard.x, z - hazard.z));
    const { lat, lon } = toGeo(x, z);
    photoCoverage[i] = mosaicCoverage(lat, lon, OUTSIDE_FADE_M);
    dataCover[i] = dataCoverage(x, z, bounds);
  }
  return { baseColors, hazardMask, photoCoverage, dataCover };
}

// 1 dentro da área com dados reais, caindo até 0 fora dela.
function dataCoverage(x, z, bounds) {
  const outsideM = Math.max(bounds.xMin - x, x - bounds.xMax, bounds.zMin - z, z - bounds.zMax);
  return clamp(1 - outsideM / OUTSIDE_FADE_M, 0, 1);
}

function rampColor(stops, t) {
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return mix(stops[index], stops[index + 1], scaled - index);
}

// Devolve a cor e a opacidade da camada em um vértice, ou null se não há o que pintar.
// `sources` traz funções (x, z) => valor para as camadas calculadas fora daqui (volta a pé, rádio, radiação).
function createLayerSampler(field, layer, sources) {
  if (layer === 'slope') {
    return (i) => {
      const slopeDeg = slopeDegOf(field.gradX[i], field.gradZ[i]);
      const match = SLOPE_COLORS.find((entry) => slopeDeg >= entry.minDeg);
      return match ? { rgb: match.rgb, alpha: SLOPE_OPACITY } : null;
    };
  }
  const spec = LAYERS[layer];
  if (!spec) return () => null;
  const stops = spec.ramp.map(linear);
  // Toda camada em rampa vem de fora (setLayerSource), com a fonte registrada em config.js.
  const source = sources[layer];
  if (!source) return () => null;
  return (i) => {
    const { x, z } = vertexXZ(field, i);
    const value = source(x, z);
    if (!Number.isFinite(value)) return null;
    return { rgb: rampColor(stops, (value - spec.min) / (spec.max - spec.min)), alpha: LAYER_OPACITY };
  };
}

// Textura ladrilhável de grão, para o chão não ficar liso visto de perto.
function createDetailTexture() {
  const size = DETAIL_TEXTURE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para gerar a textura do solo.');
  const image = context.createImageData(size, size);
  const random = mulberry32(7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Só grão fino: variação de baixa frequência no ladrilho deixaria a repetição visível.
      const fine = valueNoise(x / 8, y / 8, 5, size / 8);
      const pebble = valueNoise(x / 4, y / 4, 9, size / 4);
      const value = Math.round(255 * (0.6 + 0.2 * fine + 0.12 * pebble + 0.08 * random()));
      image.data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = DETAIL_ANISOTROPY;
  texture.channel = DETAIL_UV_CHANNEL;
  return texture;
}

/**
 * @param {{ meta: object, values: Uint16Array } | null} elevation Grade de altitude real, ou null para o relevo aproximado.
 */
export function createTerrain(elevation) {
  const field = elevation ? fieldFromElevation(elevation.meta, elevation.values) : buildHeightField();
  const geometry = buildGeometry(field);
  const southWest = toLocal(DATA_BOUNDS.south, DATA_BOUNDS.west);
  const northEast = toLocal(DATA_BOUNDS.north, DATA_BOUNDS.east);
  const bounds = { xMin: southWest.x, xMax: northEast.x, zMin: northEast.z, zMax: southWest.z };
  const { baseColors, hazardMask, photoCoverage, dataCover } = computeVertexData(field, bounds);
  const detail = createDetailTexture();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // Até a foto real chegar, um grão neutro; depois, a imagem HiRISE (attachImagery).
    map: detail,
    roughness: 0.96,
    metalness: 0,
    // Empurra o terreno um pouco para trás no depth buffer, para as linhas da rota não piscarem.
    polygonOffset: true,
    polygonOffsetFactor: 1.5,
    polygonOffsetUnits: 2,
  });

  let imagery = null;
  let closeDetail = null;
  const layerSources = {};
  let lastPaint = { layer: 'none', dimOutsideData: true };

  // Cor procedural do solo, com a zona de risco avermelhada e a camada misturada por cima.
  function proceduralColor(i, overlay, coverage) {
    const base = [baseColors[i * 3], baseColors[i * 3 + 1], baseColors[i * 3 + 2]];
    const rgb = mix(base, PALETTE.hazard, hazardMask[i] * HAZARD_TINT_STRENGTH);
    return overlay ? mix(rgb, overlay.rgb, overlay.alpha * coverage) : rgb;
  }

  // Multiplicador sobre a foto. Fora da área fotografada a textura devolve a cor média,
  // e o brilho da cor procedural dá alguma variação. A camada entra como tingimento,
  // dividida pela cor média para a foto continuar visível por baixo.
  function photoColor(i, overlay, coverage) {
    const relief = luma([baseColors[i * 3], baseColors[i * 3 + 1], baseColors[i * 3 + 2]]) / SAND_LUMA;
    let rgb = mix([relief, relief, relief], PHOTO_WHITE, photoCoverage[i]);
    rgb = mix(rgb, PHOTO_HAZARD_TINT, hazardMask[i] * HAZARD_TINT_STRENGTH);
    if (!overlay) return rgb;
    const tint = overlay.rgb.map((channel, c) => channel / imagery.meanLinear[c]);
    return mix(rgb, tint, overlay.alpha * coverage);
  }

  /**
   * @param {{ layer: 'none'|'slope'|'radiation'|'walkback'|'comms', dimOutsideData: boolean }} options
   */
  function paint(options) {
    lastPaint = options;
    const { layer, dimOutsideData } = options;
    // Com a foto, o declive real é desenhado na própria textura; sem ela, vem do relevo ilustrativo.
    const slopeFromMap = Boolean(imagery) && layer === 'slope';
    if (imagery) imagery.setSlopeOverlay(slopeFromMap);
    // O declive é pintado na própria foto; o detalhe fino usa a foto borrada e apagaria as classes.
    closeDetail?.setEnabled(!slopeFromMap);
    const sampleLayer = slopeFromMap ? () => null : createLayerSampler(field, layer, layerSources);
    const colorOf = imagery ? photoColor : proceduralColor;

    const attribute = geometry.getAttribute('color');
    for (let i = 0; i < field.heights.length; i++) {
      const coverage = dataCover[i];
      const rgb = colorOf(i, coverage > 0 ? sampleLayer(i) : null, coverage);
      // No tablet, o que fica fora da foto (ou, sem foto, fora da área de dados) aparece escurecido.
      const lit = imagery ? photoCoverage[i] : coverage;
      const brightness = dimOutsideData ? OUTSIDE_DATA_BRIGHTNESS + (1 - OUTSIDE_DATA_BRIGHTNESS) * lit : 1;
      attribute.setXYZ(i, rgb[0] * brightness, rgb[1] * brightness, rgb[2] * brightness);
    }
    attribute.needsUpdate = true;
  }

  /**
   * Troca a cor procedural pela imagem orbital real.
   * @param {{ texture: THREE.Texture, meanLinear: number[], setSlopeOverlay: (show: boolean) => void }} loaded
   */
  function attachImagery(loaded) {
    imagery = loaded;
    material.map = loaded.texture;
    material.needsUpdate = true;
    paint(lastPaint);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return Object.freeze({
    mesh,
    paint,
    attachImagery,
    // Liga o detalhe fino (64 cm e 25 cm por pixel) sobre a foto. Chamar depois de attachImagery.
    attachDetail: (detail) => {
      closeDetail = detail;
      material.onBeforeCompile = detail.patchShader;
      material.needsUpdate = true;
      paint(lastPaint);
    },
    // Registra de onde vem o valor de uma camada calculada fora do terreno.
    setLayerSource: (id, valueAt) => { layerSources[id] = valueAt; },
    field,
    isReal: field.isReal,
    cellM: field.cellM,
    heightAt: (x, z) => heightAt(field, x, z),
    probe: (x, z) => probe(field, x, z),
  });
}
