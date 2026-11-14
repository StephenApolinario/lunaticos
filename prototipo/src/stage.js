// Renderizador, câmera, luzes e a troca de ambiente entre tablet e visor.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { COLORS, SUN_DIRECTION } from './config.js';

const MAX_PIXEL_RATIO = 2;
const SUN_DISTANCE_M = 10000;

// Cada vista tem seu campo de visão, planos de corte e névoa.
// No tablet a câmera fica a quilômetros de altura, então a névoa praticamente não age.
const VIEW_SETTINGS = Object.freeze({
  tablet: { fov: 40, near: 20, far: 70000, fogNear: 14000, fogFar: 90000, showSky: false },
  visor: { fov: 68, near: 0.4, far: 45000, fogNear: 220, fogFar: 6800, showSky: true },
});

/**
 * @param {HTMLElement} container
 * @param {{ sky: THREE.Object3D, backdrop: THREE.Object3D, farGround: THREE.Object3D }} scenery
 */
export function createStage(container, scenery) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'stage-canvas';
  container.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'stage-labels';
  container.append(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.haze, VIEW_SETTINGS.tablet.fogNear, VIEW_SETTINGS.tablet.fogFar);
  const tabletBackground = new THREE.Color(COLORS.tabletBackground);

  const camera = new THREE.PerspectiveCamera(VIEW_SETTINGS.tablet.fov, 1, VIEW_SETTINGS.tablet.near, VIEW_SETTINGS.tablet.far);

  const sun = new THREE.DirectionalLight('#ffe6cc', 3);
  sun.position.set(...SUN_DIRECTION.map((component) => component * SUN_DISTANCE_M));
  scene.add(sun, new THREE.HemisphereLight('#e0b48f', '#6b4630', 1.1));
  scene.add(scenery.sky, scenery.backdrop, scenery.farGround);

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
    scenery.backdrop.visible = settings.showSky;
    scenery.farGround.visible = settings.showSky;
  }

  function render() {
    scenery.sky.position.copy(camera.position);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  return Object.freeze({ scene, camera, renderer, resize, setView, render });
}
