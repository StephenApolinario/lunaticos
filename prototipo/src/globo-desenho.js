// Desenho do globo: um triângulo cobre a tela e, em cada pixel, o sombreador calcula onde a linha de
// visada encontra a esfera. Não há malha: a esfera é exata a qualquer distância e em qualquer
// inclinação da câmera, do planeta inteiro à vista de perto que continua no modelo local.
//
// As contas que dependem da posição da câmera são feitas aqui em precisão dupla e chegam ao
// sombreador já relativas à câmera e ao centro da área mapeada (metros nos eixos leste, norte e para
// cima), para a borda da área não perder precisão de perto.
//
// A imagem sai como está no mosaico: sem luz, sem ajuste de tom e sem conversão de cor.

import * as THREE from 'three';
import { MARS_RADIUS_M } from './geo.js';
import { DEG, areaCenter, dot, enuAxes } from './globo-geo.js';

/** Quantas camadas de imagem o sombreador combina: o planeta inteiro e três retalhos. */
export const LAYER_COUNT = 4;
// Brilho de atmosfera na borda do planeta: ILUSTRATIVO. Espessura, força e quanto ele some ao olhar
// para cima foram escolhidos pela aparência; não são medidas da atmosfera de Marte.
const ATMOSPHERE = Object.freeze({ thicknessM: 0.035 * MARS_RADIUS_M, strength: 0.5, skyFade: 0.2 });

const VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D map0;
  uniform sampler2D map1;
  uniform sampler2D map2;
  uniform sampler2D map3;
  uniform vec4 rects[${LAYER_COUNT}];
  uniform float texelM[${LAYER_COUNT}];
  uniform vec3 upView;
  uniform float centerDistance;
  uniform float sphereTerm;
  uniform float height;
  uniform vec3 cameraEnu;
  uniform mat3 viewToEnu;
  uniform vec2 frustum;
  uniform float pixelRad;
  uniform float radius;
  uniform vec2 areaLat;
  uniform vec2 sinBounds;
  uniform vec2 tanBounds;
  uniform float shade;
  uniform vec3 background;
  uniform vec3 hazeTint;
  uniform vec3 haze;
  varying vec2 vNdc;

  // Borda suavizada em um pixel.
  float edge(float signedDistance) {
    return clamp(signedDistance / max(fwidth(signedDistance), 1e-20) + 0.5, 0.0, 1.0);
  }

  // O nível de detalhe vem do tamanho do pixel no chão, não das derivadas: sem emenda em 180°.
  vec4 sampleLayer(sampler2D map, vec4 rect, float texel, vec2 lonLat, float footprint) {
    vec2 uv = (lonLat - rect.xy) * rect.zw;
    return textureLod(map, uv, log2(max(footprint / texel, 1.0)));
  }

  // Retalho por cima: só vale dentro do retângulo dele, e onde o ladrilho não chegou fica o que está embaixo.
  vec3 over(vec3 below, sampler2D map, vec4 rect, float texel, vec2 lonLat, float footprint) {
    vec2 uv = (lonLat - rect.xy) * rect.zw;
    float inRect = step(0.0, min(uv.x, uv.y)) * step(max(uv.x, uv.y), 1.0);
    vec4 patchColor = sampleLayer(map, rect, texel, lonLat, footprint) * inRect;
    return patchColor.rgb + below * (1.0 - patchColor.a);
  }

  void main() {
    vec3 ray = normalize(vec3(vNdc * frustum, -1.0));
    // Encontro da visada com a esfera, com a câmera na origem. A raiz é tirada na forma que não
    // subtrai dois números quase iguais quando a câmera está rente ao chão.
    float along = -centerDistance * dot(ray, upView);
    float reach = along * along - sphereTerm;
    float range = sphereTerm / max(along + sqrt(max(reach, 0.0)), 1.0);
    float hit = clamp((along - sqrt(max(sphereTerm, 0.0))) / max(fwidth(along), 1e-20) + 0.5, 0.0, 1.0);

    // Ponto do chão em metros nos eixos leste, norte e para cima do centro da área mapeada.
    vec3 ground = cameraEnu + viewToEnu * (range * ray);
    // Diferença de seno da latitude e componentes da longitude em relação ao meridiano da área.
    float sinOffset = (ground.y * areaLat.y + ground.z * areaLat.x) / radius;
    float meridian = (radius + ground.z) * areaLat.y - ground.y * areaLat.x;
    float inside = edge(sinOffset - sinBounds.x) * edge(sinBounds.y - sinOffset)
      * edge(ground.x - meridian * tanBounds.x) * edge(meridian * tanBounds.y - ground.x)
      * step(0.0, meridian);

    vec2 lonLat = vec2(atan(ground.x, meridian), asin(clamp(areaLat.x + sinOffset, -1.0, 1.0)));
    // Tamanho do pixel no chão, maior onde a visada chega rasante.
    float footprint = range * pixelRad / sqrt(clamp((along - range) / radius, 0.05, 1.0));
    vec3 surface = sampleLayer(map0, rects[0], texelM[0], lonLat, footprint).rgb;
    surface = over(surface, map1, rects[1], texelM[1], lonLat, footprint);
    surface = over(surface, map2, rects[2], texelM[2], lonLat, footprint);
    surface = over(surface, map3, rects[3], texelM[3], lonLat, footprint);
    surface *= mix(shade, 1.0, inside);

    // Brilho ilustrativo: máximo rente ao planeta, some com a altura em que a visada passa e, vista
    // de dentro, ao olhar para cima.
    float perigee = sqrt(max(centerDistance * centerDistance - along * along, 0.0));
    float lift = along > 0.0 ? perigee - radius : height - along * haze.z;
    float glow = haze.y * pow(clamp(1.0 - lift / haze.x, 0.0, 1.0), 2.0);
    gl_FragColor = vec4(mix(mix(background, hazeTint, glow), surface, hit), 1.0);
  }
`;

// Cor como está escrita, sem a conversão de espaço de cor do Three: o sombreador não converte na saída.
const rawColor = (color) => new THREE.Color(color).convertLinearToSRGB();

/**
 * @param {{
 *   area: { south: number, north: number, west: number, east: number },
 *   shade: number,                        // brilho de tudo que fica fora da área (0 a 1)
 *   background: THREE.ColorRepresentation, // cor do espaço em volta do planeta
 *   hazeTint: THREE.ColorRepresentation,   // cor do brilho ilustrativo da borda
 * }} options
 */
export function createGlobePainter({ area, shade, background, hazeTint }) {
  const center = areaCenter(area);
  const axes = enuAxes(center.lat, center.lon);
  const anchor = axes.up.map((value) => value * MARS_RADIUS_M);
  const centerLonRad = center.lon * DEG;
  const sinCenterLat = Math.sin(center.lat * DEG);
  const uniforms = {
    map0: { value: null }, map1: { value: null }, map2: { value: null }, map3: { value: null },
    // Por camada: oeste (a partir do meridiano da área) e sul em radianos, e o inverso da largura e da altura.
    rects: { value: Array.from({ length: LAYER_COUNT }, () => new THREE.Vector4(0, 0, 1, 1)) },
    // Tamanho de um ponto da imagem no chão, em metros.
    texelM: { value: new Array(LAYER_COUNT).fill(1) },
    upView: { value: new THREE.Vector3() },
    centerDistance: { value: 0 },
    sphereTerm: { value: 0 },
    height: { value: 0 },
    cameraEnu: { value: new THREE.Vector3() },
    viewToEnu: { value: new THREE.Matrix3() },
    frustum: { value: new THREE.Vector2() },
    pixelRad: { value: 0 },
    radius: { value: MARS_RADIUS_M },
    areaLat: { value: new THREE.Vector2(sinCenterLat, Math.cos(center.lat * DEG)) },
    sinBounds: { value: new THREE.Vector2(Math.sin(area.south * DEG) - sinCenterLat, Math.sin(area.north * DEG) - sinCenterLat) },
    tanBounds: { value: new THREE.Vector2(Math.tan((area.west - center.lon) * DEG), Math.tan((area.east - center.lon) * DEG)) },
    shade: { value: shade },
    background: { value: rawColor(background) },
    hazeTint: { value: rawColor(hazeTint) },
    haze: { value: new THREE.Vector3(ATMOSPHERE.thicknessM, ATMOSPHERE.strength, ATMOSPHERE.skyFade) },
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const triangle = new THREE.Mesh(geometry, material);
  triangle.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(triangle);
  const camera = new THREE.Camera();

  /**
   * @param {Array<{ texture: THREE.Texture, bounds: { south: number, north: number, west: number, east: number } }>} layers
   *   O planeta inteiro primeiro, depois os retalhos na ordem em que ficam por cima.
   */
  function setLayers(layers) {
    if (layers.length !== LAYER_COUNT) throw new Error(`O desenho do globo espera ${LAYER_COUNT} camadas de imagem.`);
    layers.forEach(({ texture, bounds }, index) => {
      const spanLatRad = (bounds.north - bounds.south) * DEG;
      uniforms[`map${index}`].value = texture;
      uniforms.rects.value[index].set(bounds.west * DEG - centerLonRad, bounds.south * DEG, 1 / ((bounds.east - bounds.west) * DEG), 1 / spanLatRad);
      uniforms.texelM.value[index] = (MARS_RADIUS_M * spanLatRad) / texture.image.height;
    });
  }

  /**
   * Desenha o globo na tela inteira. Não muda a configuração do renderizador.
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ position: number[], right: number[], up: number[], back: number[] }} pose De `poseFromView`.
   * @param {{ fovDeg: number, aspect: number }} lens Campo de visão vertical e proporção da tela.
   */
  function draw(renderer, { position, right, up, back }, { fovDeg, aspect }) {
    const distance = Math.hypot(...position);
    const height = distance - MARS_RADIUS_M;
    const zenith = position.map((value) => value / distance);
    const offset = position.map((value, index) => value - anchor[index]);
    const tanHalfFov = Math.tan((fovDeg * DEG) / 2);
    uniforms.upView.value.set(dot(zenith, right), dot(zenith, up), dot(zenith, back));
    uniforms.centerDistance.value = distance;
    // distância² − raio², escrito como produto para a altura pequena não se perder na conta.
    uniforms.sphereTerm.value = height * (distance + MARS_RADIUS_M);
    uniforms.height.value = height;
    uniforms.cameraEnu.value.set(dot(offset, axes.east), dot(offset, axes.north), dot(offset, axes.up));
    uniforms.viewToEnu.value.set(
      dot(right, axes.east), dot(up, axes.east), dot(back, axes.east),
      dot(right, axes.north), dot(up, axes.north), dot(back, axes.north),
      dot(right, axes.up), dot(up, axes.up), dot(back, axes.up),
    );
    uniforms.frustum.value.set(tanHalfFov * aspect, tanHalfFov);
    uniforms.pixelRad.value = (2 * tanHalfFov) / renderer.domElement.height;
    renderer.render(scene, camera);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return Object.freeze({ setLayers, draw, dispose });
}
