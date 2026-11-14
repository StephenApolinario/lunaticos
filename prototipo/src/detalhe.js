// Detalhe da imagem orbital perto de onde se está olhando.
//
// A foto colorida do terreno tem 2,5 m por pixel. Aqui entram duas janelas de imagem real mais
// fina, lidas da rede só para a região em foco e recentradas quando o foco anda:
// - 64 cm por pixel, do NASA Mars Trek (ver trek.js);
// - 25 cm por pixel, da ortofoto do USGS (ver ortofoto.js).
// As duas são em tons de cinza. No terreno, a cor continua vindo da foto colorida e o detalhe
// entra como variação de brilho: (imagem fina) / (a mesma imagem borrada). Assim nada é
// inventado: o que aparece de perto é o que a HiRISE fotografou.

import * as THREE from 'three';
import { toLocal, toGeo } from './geo.js';
import { MOSAIC_METERS_PER_PX } from './tiles.js';
import { createOrthophoto } from './ortofoto.js';
import { createTrekMosaic } from './trek.js';

// Escala em que as duas imagens se encontram: formas maiores que isto vêm da foto colorida,
// menores vêm do detalhe. Folgada o bastante para um desalinhamento de poucos metros não aparecer.
const BLEND_SCALE_M = 10;
const FADE_IN_S = 0.6;
const RETRY_AFTER_S = 20;
const ANISOTROPY = 8;

// Do mais largo para o mais fino. `maxRangeM`: distância da câmera ao foco até a qual o nível compensa.
const LEVELS = Object.freeze([
  { label: '64 cm', pixels: 2048, snapPx: 256, maxRangeM: 3000, createSource: createTrekMosaic },
  { label: '25 cm', pixels: 2048, snapPx: 128, maxRangeM: 900, createSource: createOrthophoto },
]);

function createLevel(spec) {
  const source = spec.createSource();
  const { pixels } = spec;
  const texture = new THREE.DataTexture(new Uint8Array(pixels * pixels), pixels, pixels, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = ANISOTROPY;
  texture.unpackAlignment = 1;

  // rect: canto noroeste (x, z) e o inverso do tamanho, em metros locais. params: x = presença (0 a 1), y = nível de borrão.
  const rect = new THREE.Vector4(0, 0, 0, 0);
  const params = new THREE.Vector2(0, Math.log2(BLEND_SCALE_M / source.metersPerPixel));
  let origin = null;
  let pending = null;
  let failed = false;
  let retryAtS = 0;
  let clockS = 0;

  // Canto noroeste da janela centrada no foco, alinhado à grade de ladrilhos da fonte.
  function originFor(focus) {
    const { lat, lon } = toGeo(focus.x, focus.z);
    const centre = source.pixelAt(lat, lon);
    const snap = (value) => Math.round((value - pixels / 2) / spec.snapPx) * spec.snapPx;
    return { px: snap(centre.px), py: snap(centre.py) };
  }
  const isFar = (a, b) => Math.max(Math.abs(a.px - b.px), Math.abs(a.py - b.py)) >= pixels / 4;

  async function load(wanted) {
    const controller = new AbortController();
    pending = { origin: wanted, controller };
    try {
      const data = await source.read(wanted.px, wanted.py, pixels, controller.signal);
      if (controller.signal.aborted) return;
      texture.image.data.set(data);
      texture.needsUpdate = true;
      const corner = source.geoAt(wanted.px, wanted.py);
      const opposite = source.geoAt(wanted.px + pixels, wanted.py + pixels);
      const northWest = toLocal(corner.lat, corner.lon);
      const southEast = toLocal(opposite.lat, opposite.lon);
      rect.set(northWest.x, northWest.z, 1 / (southEast.x - northWest.x), 1 / (southEast.z - northWest.z));
      origin = wanted;
      failed = false;
    } catch (error) {
      if (controller.signal.aborted) return;
      failed = true;
      retryAtS = clockS + RETRY_AFTER_S;
      console.warn(`Detalhe de ${spec.label} por pixel indisponível.`, error);
    } finally {
      if (pending?.controller === controller) pending = null;
    }
  }

  return Object.freeze({
    label: spec.label,
    maxRangeM: spec.maxRangeM,
    texture,
    rect,
    params,
    hasFailed: () => failed,
    covers(focus) {
      const u = (focus.x - rect.x) * rect.z;
      const v = (focus.z - rect.y) * rect.w;
      return origin !== null && u > 0 && u < 1 && v > 0 && v < 1;
    },
    update(focus, rangeM, dtS) {
      clockS += dtS;
      if (origin) params.x = Math.min(1, params.x + dtS / FADE_IN_S);
      if (rangeM > spec.maxRangeM || clockS < retryAtS) return;
      const wanted = originFor(focus);
      const reference = pending?.origin ?? origin;
      if (reference && !isFar(wanted, reference)) return;
      pending?.controller.abort();
      load(wanted);
    },
  });
}

const VERTEX_HEAD = 'varying vec2 vTerrainXZ;';
const VERTEX_BODY = 'vTerrainXZ = position.xz;';
const FRAGMENT_HEAD = /* glsl */ `
varying vec2 vTerrainXZ;
uniform float uDetailEnabled;
uniform float uDetailBaseLod;
uniform sampler2D uDetailMap0;
uniform vec4 uDetailRect0;
uniform vec2 uDetailParams0;
uniform sampler2D uDetailMap1;
uniform vec4 uDetailRect1;
uniform vec2 uDetailParams1;

// x: quanto o nível vale neste ponto (0 a 1, some nas bordas da janela e onde não há dado).
// y: brilho da imagem fina dividido pelo dela mesma borrada.
vec2 detailLevel(sampler2D image, vec4 rect, vec2 params) {
  vec2 at = (vTerrainXZ - rect.xy) * rect.zw;
  vec2 edge = min(at, 1.0 - at);
  float sharp = texture2D(image, at).r;
  float soft = textureLod(image, at, params.y).r;
  float weight = smoothstep(0.0, 0.1, min(edge.x, edge.y)) * params.x * step(0.002, sharp);
  return vec2(weight, clamp(pow(sharp, 2.2) / max(pow(soft, 2.2), 0.002), 0.3, 3.0));
}
`;
const FRAGMENT_BODY = /* glsl */ `
#ifdef USE_MAP
{
  vec2 wide = detailLevel(uDetailMap0, uDetailRect0, uDetailParams0);
  vec2 close = detailLevel(uDetailMap1, uDetailRect1, uDetailParams1);
  float ratio = mix(mix(1.0, wide.y, wide.x), close.y, close.x);
  vec3 softColor = textureLod(map, vMapUv, uDetailBaseLod).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, softColor * ratio, max(wide.x, close.x) * uDetailEnabled);
}
#endif
`;

/**
 * @param {{ onStatus: (status: string) => void }} handlers `status` é o rótulo do nível mais fino
 *   sobre o foco ('64 cm', '25 cm'), 'offline' se a rede falhou, ou '' quando não há detalhe.
 */
export function createDetailImagery({ onStatus }) {
  const levels = LEVELS.map(createLevel);
  const uniforms = {
    uDetailEnabled: { value: 1 },
    uDetailBaseLod: { value: Math.log2(BLEND_SCALE_M / MOSAIC_METERS_PER_PX) },
  };
  levels.forEach((level, i) => {
    uniforms[`uDetailMap${i}`] = { value: level.texture };
    uniforms[`uDetailRect${i}`] = { value: level.rect };
    uniforms[`uDetailParams${i}`] = { value: level.params };
  });
  let status = '';

  return Object.freeze({
    // Para usar em `material.onBeforeCompile` de um material com `map` (a foto colorida).
    patchShader(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_BODY}`);
    },
    setEnabled(isEnabled) {
      uniforms.uDetailEnabled.value = isEnabled ? 1 : 0;
    },
    /**
     * @param {{ x: number, z: number }} focus Ponto do chão em foco, em metros locais.
     * @param {number} rangeM Distância da câmera até o foco.
     */
    update(focus, rangeM, dtS) {
      for (const level of levels) level.update(focus, rangeM, dtS);
      const inRange = levels.filter((level) => rangeM <= level.maxRangeM);
      const finest = inRange.findLast((level) => level.covers(focus));
      const next = finest ? finest.label : inRange.some((level) => level.hasFailed()) ? 'offline' : '';
      if (next === status) return;
      status = next;
      onStatus(status);
    },
  });
}
