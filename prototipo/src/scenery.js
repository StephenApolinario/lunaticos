// Cenário em volta do terreno: o céu, o chão além da área com dados, as laterais do bloco de relevo
// e o habitat proposto.
//
// A cor do céu é ilustrativa e o habitat é a proposta da equipe. O chão em volta recebe a imagem
// real da região quando ela chega (ver entorno.js), mas é um plano: fora do modelo de elevação não
// há relevo. As laterais só fecham o bloco, para ele não parecer uma folha solta. Não há rochas soltas nem montanhas desenhadas: de perto, o que se vê no chão
// é a imagem real da HiRISE, e o relevo é só o do modelo de elevação.

import * as THREE from 'three';
import { STOPS } from '../data/travessia.js';
import { toLocal } from './geo.js';
import { FIELD } from './heightfield.js';
import { COLORS } from './config.js';

const SKY_RADIUS_M = 30000;
// O plano fica abaixo do ponto mais baixo do relevo, para nunca cobrir o terreno.
const GROUND = Object.freeze({ sizeM: 250000, y: -230, color: '#8a5f45' });
// Cor de terra em sombra, para a lateral do bloco não virar uma faixa preta.
const SKIRT = Object.freeze({ stepM: 16, color: '#3b2a1f' });

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
  uniform float brightness;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float height = pow(clamp(direction.y, 0.0, 1.0), 0.45);
    vec3 color = mix(horizonColor, zenithColor, height) * brightness;
    float sun = max(dot(direction, sunDirection), 0.0);
    // Disco pequeno e halo azulado, como o Sol visto de Marte. Some quando ele está abaixo do horizonte.
    color += vec3(0.75, 0.85, 1.0) * (pow(sun, 900.0) * 8.0 + pow(sun, 14.0) * 0.28) * smoothstep(-0.06, 0.02, sunDirection.y);
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
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      brightness: { value: 1 },
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

// Plano além da área com dados. Nasce liso e recebe a imagem real da região quando ela chega.
function createFarGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: GROUND.color }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND.y;
  ground.scale.set(GROUND.sizeM, GROUND.sizeM, 1);
  return ground;
}

// Laterais do bloco de relevo: paredes escuras da borda do terreno até o plano de baixo.
function createSkirt(terrain) {
  const { halfWidth, halfDepth } = FIELD;
  const corners = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  const border = corners.flatMap(([x0, z0], side) => {
    const [x1, z1] = corners[(side + 1) % corners.length];
    const steps = Math.round(Math.hypot(x1 - x0, z1 - z0) / SKIRT.stepM);
    return Array.from({ length: steps }, (_, i) => [x0 + ((x1 - x0) * i) / steps, z0 + ((z1 - z0) * i) / steps]);
  });
  const positions = new Float32Array(border.length * 6 * 3);
  border.forEach(([x, z], i) => {
    const [nextX, nextZ] = border[(i + 1) % border.length];
    const top = terrain.heightAt(x, z);
    const nextTop = terrain.heightAt(nextX, nextZ);
    positions.set([x, top, z, x, GROUND.y, z, nextX, nextTop, nextZ, nextX, nextTop, nextZ, x, GROUND.y, z, nextX, GROUND.y, nextZ], i * 18);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: SKIRT.color, side: THREE.DoubleSide }));
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
 */
export function createScenery(terrain) {
  const sky = createSky();
  const farGround = createFarGround();
  // Cor de base do chão (lisa até a imagem chegar; branca depois, para a imagem aparecer como é),
  // quanto ele é escurecido na vista atual e a claridade do céu.
  const groundColor = new THREE.Color(GROUND.color);
  let groundDim = 1;
  let skyBrightness = 1;
  const tintGround = () => farGround.material.color.copy(groundColor).multiplyScalar(groundDim * skyBrightness);
  const props = new THREE.Group();
  props.add(createHabitat(terrain), createSkirt(terrain));
  return Object.freeze({
    sky,
    farGround,
    props,
    /**
     * @param {number[]} direction Vetor (leste, cima, sul) até o Sol.
     * @param {number} brightness Claridade do céu, de 0 (noite) a 1 (dia).
     */
    setSun(direction, brightness) {
      sky.material.uniforms.sunDirection.value.set(...direction);
      sky.material.uniforms.brightness.value = brightness;
      skyBrightness = brightness;
      tintGround();
    },
    /** @param {number} dim Brilho do chão em volta: 1 no visor; no tablet, a sombra de fora da área mapeada. */
    setGroundDim(dim) {
      groundDim = dim;
      tintGround();
    },
    /**
     * Põe a imagem real da região no chão em volta (ver entorno.js).
     * @param {{ texture: THREE.Texture, centerX: number, centerZ: number, widthM: number, depthM: number }} surroundings
     */
    setSurroundings({ texture, centerX, centerZ, widthM, depthM }) {
      farGround.position.set(centerX, GROUND.y, centerZ);
      farGround.scale.set(widthM, depthM, 1);
      farGround.material.map = texture;
      farGround.material.needsUpdate = true;
      groundColor.set('#ffffff');
      tintGround();
    },
  });
}
