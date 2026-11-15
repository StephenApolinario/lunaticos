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
import { FINE_BANDS } from './foto-fina.js';

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
  // Chegou uma janela nova desde o último `update`: a cena mudou mesmo com a presença já em 1.
  let isFresh = false;

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
      isFresh = true;
    } catch (error) {
      if (controller.signal.aborted) return;
      failed = true;
      retryAtS = clockS + RETRY_AFTER_S;
      console.warn(`Detalhe de ${spec.label} por pixel indisponível.`, error);
    } finally {
      if (pending?.controller === controller) pending = null;
    }
  }

  // Pede outra janela quando o nível compensa a esta distância e o foco andou o bastante.
  function follow(focus, rangeM) {
    if (rangeM > spec.maxRangeM || clockS < retryAtS) return;
    const wanted = originFor(focus);
    const reference = pending?.origin ?? origin;
    if (reference && !isFar(wanted, reference)) return;
    pending?.controller.abort();
    load(wanted);
  }

  return Object.freeze({
    label: spec.label,
    maxRangeM: spec.maxRangeM,
    texture,
    rect,
    params,
    hasFailed: () => failed,
    /** Tira o nível de cena (a qualidade escolhida não o usa): some do terreno e para de carregar. */
    disable() {
      params.x = 0;
      pending?.controller.abort();
    },
    covers(focus) {
      const u = (focus.x - rect.x) * rect.z;
      const v = (focus.z - rect.y) * rect.w;
      return origin !== null && u > 0 && u < 1 && v > 0 && v < 1;
    },
    /** @returns {boolean} Se o que o nível mostra mudou neste quadro (janela nova ou ainda entrando em cena). */
    update(focus, rangeM, dtS) {
      clockS += dtS;
      const presence = params.x;
      if (origin) params.x = Math.min(1, presence + dtS / FADE_IN_S);
      const hasChanged = isFresh || params.x !== presence;
      isFresh = false;
      follow(focus, rangeM);
      return hasChanged;
    },
  });
}

const VERTEX_HEAD = 'varying vec2 vTerrainXZ;';
const VERTEX_BODY = 'vTerrainXZ = position.xz;';
const FRAGMENT_HEAD = /* glsl */ `
varying vec2 vTerrainXZ;
uniform float uDetailEnabled;
uniform float uDetailBaseLod;
uniform float uGrain;
uniform sampler2D uDetailMap0;
uniform vec4 uDetailRect0;
uniform vec2 uDetailParams0;
uniform sampler2D uDetailMap1;
uniform vec4 uDetailRect1;
uniform vec2 uDetailParams1;
uniform float uFineOn;
uniform vec4 uFineBounds;
uniform sampler2D uFineMap0;
uniform vec4 uFineRect0;
uniform sampler2D uFineMap1;
uniform vec4 uFineRect1;
uniform sampler2D uFineMap2;
uniform vec4 uFineRect2;

// Foto fina pronta (0,69 m por pixel), em faixas de norte a sul. Devolve a cor e 1 em w quando o
// ponto cai na faixa. As derivadas vêm de fora porque a leitura fica dentro de um desvio.
vec4 fineBand(sampler2D image, vec4 rect, vec2 dx, vec2 dy) {
  vec2 at = (vTerrainXZ - rect.xy) * rect.zw;
  if (at.x <= 0.0 || at.x >= 1.0 || at.y < 0.0 || at.y >= 1.0) return vec4(0.0);
  // A imagem tem o norte em cima e a textura guarda a imagem de cabeça para baixo.
  vec2 scale = vec2(rect.z, -rect.w);
  return vec4(textureGrad(image, vec2(at.x, 1.0 - at.y), dx * scale, dy * scale).rgb, 1.0);
}

// Ruído suave para o grão do chão. O módulo mantém os números pequenos longe da origem do mapa.
float grainHash(vec2 cell) {
  vec2 p = fract(mod(cell, 512.0) * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.y);
}
float grain(vec2 at) {
  vec2 cell = floor(at);
  vec2 f = fract(at);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(cell), grainHash(cell + vec2(1.0, 0.0)), u.x), mix(grainHash(cell + vec2(0.0, 1.0)), grainHash(cell + vec2(1.0, 1.0)), u.x), u.y);
}

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
if (uFineOn > 0.5) {
  vec2 fineDx = dFdx(vTerrainXZ);
  vec2 fineDy = dFdy(vTerrainXZ);
  vec4 fine = fineBand(uFineMap0, uFineRect0, fineDx, fineDy) + fineBand(uFineMap1, uFineRect1, fineDx, fineDy) + fineBand(uFineMap2, uFineRect2, fineDx, fineDy);
  // Some aos poucos na borda da área, para não aparecer um degrau contra a foto de 2,5 m.
  vec2 inside = (vTerrainXZ - uFineBounds.xy) * uFineBounds.zw;
  float fade = smoothstep(0.0, 0.003, min(min(inside.x, 1.0 - inside.x), min(inside.y, 1.0 - inside.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, fine.rgb / max(fine.a, 1.0), min(fine.a, 1.0) * fade);
}
// Sem nível de detalhe em cena (qualidades mínima e média), a mistura inteira é pulada: são quatro
// leituras de textura a menos por pixel.
if (uDetailEnabled > 0.0 && uDetailParams0.x + uDetailParams1.x > 0.0) {
  vec2 wide = detailLevel(uDetailMap0, uDetailRect0, uDetailParams0);
  vec2 close = detailLevel(uDetailMap1, uDetailRect1, uDetailParams1);
  float ratio = mix(mix(1.0, wide.y, wide.x), close.y, close.x);
  vec3 softColor = textureLod(map, vMapUv, uDetailBaseLod).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, softColor * ratio, max(wide.x, close.x) * uDetailEnabled);
}
#endif
// Grão do chão visto de perto, só no visor. É aparência, não dado: a 2 m dos olhos cada pixel da
// foto de 25 cm vira um borrão, e o grão devolve a noção de escala sem mudar a cor média.
if (uGrain > 0.0) {
  float eyeM = length(vViewPosition);
  float fine = grain(vTerrainXZ * 9.0) * 0.55 + grain(vTerrainXZ * 33.0) * 0.45;
  float coarse = grain(vTerrainXZ * 1.6) * 0.6 + grain(vTerrainXZ * 0.37) * 0.4;
  float nearby = 1.0 - smoothstep(4.0, 60.0, eyeM);
  float around = 1.0 - smoothstep(25.0, 180.0, eyeM);
  diffuseColor.rgb *= 1.0 + ((fine - 0.5) * 0.8 * nearby + (coarse - 0.5) * 0.4 * around) * uGrain;
}
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
    uGrain: { value: 0 },
    uFineOn: { value: 0 },
    uFineBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  // Até a foto fina chegar (ou nas qualidades que não a usam), as três faixas apontam para um pixel vazio.
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  for (let band = 0; band < FINE_BANDS; band++) {
    uniforms[`uFineMap${band}`] = { value: blank };
    uniforms[`uFineRect${band}`] = { value: new THREE.Vector4(0, 0, 0, 0) };
  }
  levels.forEach((level, i) => {
    uniforms[`uDetailMap${i}`] = { value: level.texture };
    uniforms[`uDetailRect${i}`] = { value: level.rect };
    uniforms[`uDetailParams${i}`] = { value: level.params };
  });
  let status = '';
  // Quantos níveis entram, do mais largo ao mais fino: decidido pela qualidade (QUALITY em config.js).
  let active = levels;

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
    /** Liga o grão do chão de perto (só no visor). */
    setGrain(isOn) {
      uniforms.uGrain.value = isOn ? 1 : 0;
    },
    setEnabled(isEnabled) {
      uniforms.uDetailEnabled.value = isEnabled ? 1 : 0;
    },
    /** @param {string[]} labels Níveis lidos da rede que entram em cena ('64 cm', '25 cm'); vazio = nenhum. */
    setLiveLevels(labels) {
      active = levels.filter((level) => labels.includes(level.label));
      for (const level of levels) if (!active.includes(level)) level.disable();
    },
    /**
     * Liga a foto fina pronta (ver foto-fina.js) ou desliga com null.
     * @param {{ textures: THREE.Texture[], rects: THREE.Vector4[], bounds: THREE.Vector4 } | null} photo
     */
    setFinePhoto(photo) {
      uniforms.uFineOn.value = photo ? 1 : 0;
      if (!photo) return;
      uniforms.uFineBounds.value.copy(photo.bounds);
      photo.textures.forEach((texture, band) => {
        uniforms[`uFineMap${band}`].value = texture;
        uniforms[`uFineRect${band}`].value.copy(photo.rects[band]);
      });
    },
    /**
     * @param {{ x: number, z: number }} focus Ponto do chão em foco, em metros locais.
     * @param {number} rangeM Distância da câmera até o foco.
     * @returns {boolean} Se a imagem em cena mudou neste quadro; parado e sem mudança, não há o que redesenhar.
     */
    update(focus, rangeM, dtS) {
      // Sem atalho: todos os níveis avançam, cada um consome o próprio aviso de janela nova.
      const hasChanged = active.map((level) => level.update(focus, rangeM, dtS)).includes(true);
      const inRange = active.filter((level) => rangeM <= level.maxRangeM);
      const finest = inRange.findLast((level) => level.covers(focus));
      const next = finest ? finest.label : inRange.some((level) => level.hasFailed()) ? 'offline' : '';
      if (next !== status) {
        status = next;
        onStatus(status);
      }
      return hasChanged;
    },
  });
}
