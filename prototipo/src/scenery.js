// Cenário do modo visor: céu, montanhas ao fundo, chão distante, rochas e habitat.

import * as THREE from 'three';
import { HAZARD, STOPS } from '../data/travessia.js';
import { toLocal } from './geo.js';
import { valueNoise, mulberry32 } from './noise.js';
import { COLORS, SUN_DIRECTION } from './config.js';

const SKY_RADIUS_M = 30000;
const BACKDROP = Object.freeze({ radiusM: 16000, heightM: 4200, baseY: -260, widthPx: 2048, heightPx: 256 });
const GROUND = Object.freeze({ radiusM: 42000, y: -190, color: '#8a5f45' });
const ROCKS = Object.freeze({ count: 6000, minOffsetM: 4, spreadM: 150, seed: 42, placementTries: 8 });
const PATH_CELL_M = 5;
const SPIKES = Object.freeze({ count: 700, seed: 99 });
const TWO_PI = Math.PI * 2;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 horizonColor;
  uniform vec3 zenithColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float height = pow(clamp(direction.y, 0.0, 1.0), 0.45);
    vec3 color = mix(horizonColor, zenithColor, height);
    float sun = max(dot(direction, sunDirection), 0.0);
    // Disco pequeno e halo azulado, como o Sol visto de Marte.
    color += vec3(0.75, 0.85, 1.0) * (pow(sun, 900.0) * 8.0 + pow(sun, 14.0) * 0.28);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createSky() {
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      horizonColor: { value: new THREE.Color(COLORS.haze) },
      zenithColor: { value: new THREE.Color(COLORS.zenith) },
      sunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS_M, 32, 16), material);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

// Altura da silhueta (0 a 1) por rumo. u = 0 é o sul, 0,5 é o norte.
function ridgeHeight(u, layer) {
  const distanceFromSouth = Math.min(u, 1 - u);
  const distanceFromNorth = Math.abs(u - 0.5);
  const mountSharp = Math.exp(-((distanceFromSouth / layer.sharpWidth) ** 2)) * layer.sharpHeight;
  const craterRim = Math.exp(-((distanceFromNorth / 0.16) ** 2)) * layer.rimHeight;
  const noise = valueNoise(u * 48, 0, layer.seed, 48) * 0.65 + valueNoise(u * 160, 0, layer.seed + 1, 160) * 0.35;
  return layer.base + mountSharp + craterRim + noise * layer.roughness;
}

const RIDGE_LAYERS = Object.freeze([
  { color: '#b99a82', base: 0.2, sharpHeight: 0.62, sharpWidth: 0.1, rimHeight: 0.1, roughness: 0.06, seed: 3 },
  { color: '#ab8a70', base: 0.14, sharpHeight: 0.3, sharpWidth: 0.16, rimHeight: 0.03, roughness: 0.07, seed: 8 },
  { color: '#9c7a61', base: 0.08, sharpHeight: 0.1, sharpWidth: 0.2, rimHeight: 0, roughness: 0.06, seed: 15 },
]);

function createBackdrop() {
  const canvas = document.createElement('canvas');
  canvas.width = BACKDROP.widthPx;
  canvas.height = BACKDROP.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para desenhar o horizonte.');
  for (const layer of RIDGE_LAYERS) {
    context.fillStyle = layer.color;
    context.beginPath();
    context.moveTo(0, canvas.height);
    for (let px = 0; px <= canvas.width; px += 2) {
      context.lineTo(px, canvas.height * (1 - ridgeHeight(px / canvas.width, layer)));
    }
    context.lineTo(canvas.width, canvas.height);
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const geometry = new THREE.CylinderGeometry(BACKDROP.radiusM, BACKDROP.radiusM, BACKDROP.heightM, 96, 1, true);
  const backdrop = new THREE.Mesh(geometry, material);
  backdrop.position.y = BACKDROP.baseY + BACKDROP.heightM / 2;
  backdrop.renderOrder = -1;
  return backdrop;
}

function createFarGround() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(GROUND.radiusM, 48),
    new THREE.MeshBasicMaterial({ color: GROUND.color }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND.y;
  return ground;
}

function placeInstances(mesh, count, placeOne) {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    placeOne(dummy, color);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// Diz se um ponto cai em cima de alguma rota (a menos de ~5 m do eixo), para não pôr rocha no caminho.
function createPathTest(corridor) {
  const cells = new Set();
  const mark = (x, z) => cells.add(`${Math.floor(x / PATH_CELL_M)},${Math.floor(z / PATH_CELL_M)}`);
  corridor.forEach((point, i) => {
    mark(point.x, point.z);
    const next = corridor[i + 1];
    if (next) mark((point.x + next.x) / 2, (point.z + next.z) / 2);
  });
  return (x, z) => {
    const cx = Math.floor(x / PATH_CELL_M);
    const cz = Math.floor(z / PATH_CELL_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (cells.has(`${cx + dx},${cz + dz}`)) return true;
      }
    }
    return false;
  };
}

// Rochas soltas espalhadas perto dos corredores de rota, para dar escala de perto.
function createRocks(terrain, corridor) {
  const random = mulberry32(ROCKS.seed);
  const isOnPath = createPathTest(corridor);
  const pickSpot = () => {
    const base = corridor[Math.floor(random() * corridor.length)];
    const angle = random() * TWO_PI;
    const offset = ROCKS.minOffsetM + random() ** 2 * ROCKS.spreadM;
    return { x: base.x + Math.cos(angle) * offset, z: base.z + Math.sin(angle) * offset };
  };
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material, ROCKS.count);
  return placeInstances(mesh, ROCKS.count, (dummy, color) => {
    let spot = pickSpot();
    for (let attempt = 1; attempt < ROCKS.placementTries && isOnPath(spot.x, spot.z); attempt++) spot = pickSpot();
    // Se ainda assim caiu na rota, vira um pedregulho pequeno que não atrapalha a passagem.
    const size = isOnPath(spot.x, spot.z) ? 0.08 : 0.12 + random() ** 5 * 1.8;
    const { x, z } = spot;
    dummy.position.set(x, terrain.heightAt(x, z) + size * 0.2, z);
    dummy.scale.set(size * (0.7 + random() * 0.6), size * (0.45 + random() * 0.45), size * (0.7 + random() * 0.6));
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    color.setHSL(0.055 + random() * 0.02, 0.32 + random() * 0.12, 0.2 + random() * 0.16);
  });
}

// Lâminas de rocha na zona de risco (as "gator-back" que furam rodas e botas).
function createHazardSpikes(terrain) {
  const random = mulberry32(SPIKES.seed);
  const center = toLocal(HAZARD.lat, HAZARD.lon);
  const radiusM = HAZARD.radiusKm * 1000;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.3, 5), material, SPIKES.count);
  return placeInstances(mesh, SPIKES.count, (dummy, color) => {
    const angle = random() * TWO_PI;
    const offset = Math.sqrt(random()) * radiusM;
    const x = center.x + Math.cos(angle) * offset;
    const z = center.z + Math.sin(angle) * offset;
    const size = 0.5 + random() * 1.3;
    dummy.position.set(x, terrain.heightAt(x, z) + size * 0.4, z);
    dummy.scale.set(size, size, size * 0.45);
    dummy.rotation.set((random() - 0.5) * 0.9, random() * Math.PI, (random() - 0.5) * 0.9);
    color.setHSL(0.03, 0.3, 0.14 + random() * 0.1);
  });
}

function createHabitat(terrain) {
  const habitatStop = STOPS.find((stop) => stop.id === 'H');
  if (!habitatStop) throw new Error('Parada do habitat (H) ausente nos dados.');
  const { x, z } = toLocal(habitatStop.lat, habitatStop.lon);
  const shell = new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 7, 6, 20), shell);
  body.rotation.z = Math.PI / 2;
  body.position.y = 3.4;
  const airlock = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.6), shell);
  airlock.position.set(0, 1.5, 4);
  const habitat = new THREE.Group();
  habitat.add(body, airlock);
  // Fica 18 m ao lado do início da rota, para não bloquear a saída.
  habitat.position.set(x - 18, terrain.heightAt(x - 18, z), z);
  habitat.rotation.y = 0.5;
  return habitat;
}

/**
 * @param {{ heightAt: (x: number, z: number) => number }} terrain
 * @param {Array<{ x: number, z: number }>} corridor Pontos por onde as rotas passam.
 */
export function createScenery(terrain, corridor) {
  const sky = createSky();
  const backdrop = createBackdrop();
  const farGround = createFarGround();
  const props = new THREE.Group();
  props.add(createRocks(terrain, corridor), createHazardSpikes(terrain), createHabitat(terrain));
  return Object.freeze({ sky, backdrop, farGround, props });
}
