// Renderizador, câmera, luzes e a troca de ambiente entre tablet e visor.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { COLORS, OUTSIDE_AREA_BRIGHTNESS } from './config.js';

// Luz do Sol e sombra do relevo. A sombra cobre a área inteira do terreno (cerca de 2,7 m por
// ponto do mapa de sombra) e só é refeita quando o Sol muda de lugar.
const SUN = Object.freeze({
  distanceM: 12000, intensity: 3, skyLight: 1.1, nightLight: 0.14,
  shadowMapPx: 4096, shadowHalfM: 5600, shadowDepthM: 7000, shadowBias: -0.0004, shadowNormalBiasM: 3,
});
// O desvio da sombra foi ajustado para o mapa de 4096 px; num mapa menor cada ponto cobre mais chão.
const normalBiasFor = (shadowMapPx) => SUN.shadowNormalBiasM * (SUN.shadowMapPx / shadowMapPx);
// Alturas do Sol (graus) entre as quais a luz direta e a claridade do céu vão de zero ao máximo.
const DIRECT_RAMP_DEG = Object.freeze([-1, 14]);
const SKY_RAMP_DEG = Object.freeze([-9, 8]);
const ramp = ([from, to], value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

// Cada vista tem seu campo de visão, planos de corte e névoa.
// No tablet a câmera fica a quilômetros de altura, então a névoa praticamente não age no mapa; ela
// só desmancha no horizonte o chão em volta, que aparece escurecido por estar fora da área mapeada.
const VIEW_SETTINGS = Object.freeze({
  tablet: { fov: 40, near: 20, far: 140000, fogNear: 14000, fogFar: 90000, showSky: true, groundDim: OUTSIDE_AREA_BRIGHTNESS },
  visor: { fov: 68, near: 0.4, far: 45000, fogNear: 220, fogFar: 6800, showSky: true, groundDim: 1 },
});

/**
 * @param {HTMLElement} container
 * @param {{ sky: THREE.Object3D, farGround: THREE.Object3D, setSun: (direction: number[], brightness: number) => void }} scenery
 */
export function createStage(container, scenery) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.className = 'stage-canvas';
  container.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.append(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.haze, VIEW_SETTINGS.tablet.fogNear, VIEW_SETTINGS.tablet.fogFar);
  const tabletBackground = new THREE.Color(COLORS.tabletBackground);

  const camera = new THREE.PerspectiveCamera(VIEW_SETTINGS.tablet.fov, 1, VIEW_SETTINGS.tablet.near, VIEW_SETTINGS.tablet.far);

  const sun = new THREE.DirectionalLight('#ffe6cc', SUN.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SUN.shadowMapPx, SUN.shadowMapPx);
  sun.shadow.bias = SUN.shadowBias;
  sun.shadow.normalBias = SUN.shadowNormalBiasM;
  Object.assign(sun.shadow.camera, {
    left: -SUN.shadowHalfM, right: SUN.shadowHalfM, top: SUN.shadowHalfM, bottom: -SUN.shadowHalfM,
    near: SUN.distanceM - SUN.shadowDepthM, far: SUN.distanceM + SUN.shadowDepthM,
  });
  sun.shadow.camera.updateProjectionMatrix();
  // A qualidade escolhida decide se o relevo projeta sombra (ver `setQuality`).
  let castsShadows = true;
  const skyLight = new THREE.HemisphereLight('#e0b48f', '#6b4630', SUN.skyLight);
  const hazeColor = new THREE.Color(COLORS.haze);
  scene.add(sun, skyLight, scenery.sky, scenery.farGround);

  /**
   * Põe o Sol onde ele está no céu e ajusta a claridade.
   * @param {{ direction: number[], elevationDeg: number }} position Ver `sunAt` em luz.js.
   */
  function setSun({ direction, elevationDeg }) {
    const skyBrightness = ramp(SKY_RAMP_DEG, elevationDeg);
    sun.position.set(...direction.map((component) => component * SUN.distanceM));
    sun.intensity = SUN.intensity * ramp(DIRECT_RAMP_DEG, elevationDeg);
    sun.castShadow = castsShadows && sun.intensity > 0;
    skyLight.intensity = SUN.nightLight + (SUN.skyLight - SUN.nightLight) * skyBrightness;
    scene.fog.color.copy(hazeColor).multiplyScalar(skyBrightness);
    scenery.setSun(direction, skyBrightness);
    renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Aplica um nível de qualidade (ver QUALITY em config.js): pixels por ponto da tela e a sombra
   * projetada pelo relevo.
   * @param {{ pixelRatio: number, shadowMapPx: number, softShadows: boolean }} quality
   */
  function setQuality({ pixelRatio, shadowMapPx, softShadows }) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
    castsShadows = shadowMapPx > 0;
    if (castsShadows && sun.shadow.mapSize.x !== shadowMapPx) {
      sun.shadow.mapSize.set(shadowMapPx, shadowMapPx);
      sun.shadow.normalBias = normalBiasFor(shadowMapPx);
      // O mapa antigo é jogado fora; o Three cria outro do tamanho novo no próximo quadro.
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const shadowType = softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (renderer.shadowMap.type !== shadowType) {
      renderer.shadowMap.type = shadowType;
      // O tipo de sombra está embutido no programa de cada material: é preciso recompilar.
      scene.traverse((object) => {
        for (const material of [object.material].flat()) if (material) material.needsUpdate = true;
      });
    }
    sun.castShadow = castsShadows && sun.intensity > 0;
    renderer.shadowMap.needsUpdate = true;
    resize();
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /** @param {'tablet'|'visor'} view */
  function setView(view) {
    const settings = VIEW_SETTINGS[view];
    if (!settings) throw new Error(`Vista desconhecida: ${view}`);
    camera.fov = settings.fov;
    camera.near = settings.near;
    camera.far = settings.far;
    camera.updateProjectionMatrix();
    scene.fog.near = settings.fogNear;
    scene.fog.far = settings.fogFar;
    scene.background = settings.showSky ? null : tabletBackground;
    scenery.sky.visible = settings.showSky;
    scenery.farGround.visible = settings.showSky;
    scenery.setGroundDim(settings.groundDim);
  }

  function render() {
    scenery.sky.position.copy(camera.position);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  return Object.freeze({ scene, camera, renderer, resize, setView, setSun, setQuality, render });
}
