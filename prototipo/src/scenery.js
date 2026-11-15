// Cenário em volta do terreno: o céu, o chão além da área com dados e o habitat proposto.
//
// Nada aqui é dado de Marte: a cor do céu e o chão distante são ilustrativos, e o habitat é a
// proposta da equipe. Não há rochas soltas nem montanhas desenhadas: de perto, o que se vê no chão
// é a imagem real da HiRISE, e o relevo é só o do modelo de elevação.

import * as THREE from 'three';
import { STOPS } from '../data/travessia.js';
import { toLocal } from './geo.js';
import { COLORS } from './config.js';

const SKY_RADIUS_M = 30000;
const GROUND = Object.freeze({ radiusM: 42000, y: -190, color: '#8a5f45' });

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

// Plano liso além da área com dados, só para o horizonte não ficar vazio.
function createFarGround() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(GROUND.radiusM, 48),
    new THREE.MeshBasicMaterial({ color: GROUND.color }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND.y;
  return ground;
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
  const groundColor = new THREE.Color(GROUND.color);
  const props = new THREE.Group();
  props.add(createHabitat(terrain));
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
      farGround.material.color.copy(groundColor).multiplyScalar(brightness);
    },
  });
}
