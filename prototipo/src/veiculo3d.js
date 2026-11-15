// Veículo da saída em 3D: um buggy aberto de dois lugares, montado com formas simples do Three.js.
// É só aparência (não vem de dado nem de modelo pronto). Segue a ideia do jipe lunar da Apollo, em
// que o astronauta vai de traje: é o que o protótipo assume para o consumo de oxigênio no veículo.

import * as THREE from 'three';

const DEG = Math.PI / 180;

export const VEHICLE = Object.freeze({
  wheelbaseM: 2.3,
  trackM: 1.9,
  wheelRadiusM: 0.5,
  wheelWidthM: 0.36,
  // Olhos de quem dirige, no referencial do veículo: x para a direita, y para cima, z para trás.
  seat: Object.freeze({ x: -0.42, y: 1.85, z: 0.15 }),
  // Onde o veículo fica quando o astronauta desce: à frente e à direita de onde ele parou.
  parked: Object.freeze({ aheadM: 4.4, rightM: 2.6 }),
});

const COLORS = Object.freeze({ body: 0xe9ebee, frame: 0x1b1c20, tire: 0xaeb2ba, lug: 0x8d9199, seat: 0x7d828c, accent: 0x60a5fa, dish: 0xc9a24b, light: 0xfff4d6 });
const CAGE_RADIUS_M = 0.04;
const LUGS_PER_WHEEL = 14;
const UP = new THREE.Vector3(0, 1, 0);

function box(material, [width, height, depth], [x, y, z], tiltX = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.x = tiltX;
  return mesh;
}

// Tubo reto entre dois pontos, para a gaiola e os braços da suspensão.
function tube(material, from, to, radius = CAGE_RADIUS_M) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 10), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, end.clone().sub(start).normalize());
  return mesh;
}

function createWheel(materials) {
  const { wheelRadiusM: radius, wheelWidthM: width } = VEHICLE;
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 28), materials.tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width + 0.04, 20), materials.accent);
  tire.rotation.z = Math.PI / 2;
  hub.rotation.z = Math.PI / 2;
  wheel.add(tire, hub);
  for (let i = 0; i < LUGS_PER_WHEEL; i++) {
    const angle = (i / LUGS_PER_WHEEL) * Math.PI * 2;
    const lug = box(materials.lug, [width + 0.03, 0.07, 0.12], [0, Math.cos(angle) * radius, Math.sin(angle) * radius], angle);
    wheel.add(lug);
  }
  return wheel;
}

function buildBody(materials) {
  const { body, frame, seat, accent, dish, light } = materials;
  const parts = [
    // Banheira, piso, capô e para-choque.
    box(body, [1.5, 0.42, 2.3], [0, 0.82, 0.25]),
    box(frame, [1.3, 0.1, 2.7], [0, 0.58, 0.1]),
    box(body, [1.46, 0.2, 1.05], [0, 1.1, -1.3], -0.1),
    box(frame, [1.3, 0.3, 0.12], [0, 0.9, -1.86]),
    box(light, [0.22, 0.1, 0.04], [-0.48, 1.0, -1.93]),
    box(light, [0.22, 0.1, 0.04], [0.48, 1.0, -1.93]),
    // Painel, tela e o manche em T entre os bancos (como no jipe lunar).
    box(frame, [1.46, 0.22, 0.14], [0, 1.26, -0.72]),
    box(accent, [0.26, 0.12, 0.02], [0, 1.38, -0.66], -0.35),
    tube(frame, [0, 1.05, -0.28], [0, 1.4, -0.36], 0.025),
    tube(frame, [-0.1, 1.4, -0.36], [0.1, 1.4, -0.36], 0.025),
    // Para-lamas e faixas laterais.
    ...[-1, 1].flatMap((side) => [
      box(body, [0.44, 0.06, 1.05], [side * 0.95, 1.09, -1.15]),
      box(body, [0.44, 0.06, 1.05], [side * 0.95, 1.09, 1.15]),
      box(accent, [0.02, 0.1, 1.8], [side * 0.76, 0.9, 0.25]),
      // Bancos: assento e encosto.
      box(seat, [0.52, 0.12, 0.52], [side * 0.42, 1.08, 0.2]),
      box(seat, [0.52, 0.75, 0.1], [side * 0.42, 1.5, 0.52], 0.12),
      // Gaiola só atrás dos bancos (arco, trilho do teto e coluna traseira): a frente fica aberta,
      // como no jipe lunar, para nada cruzar a visão de quem dirige nem as marcas do visor.
      tube(frame, [side * 0.7, 2.28, 0.66], [side * 0.7, 2.28, 0.95]),
      tube(frame, [side * 0.72, 1.03, 0.66], [side * 0.7, 2.28, 0.66]),
      tube(frame, [side * 0.7, 2.28, 0.95], [side * 0.74, 1.03, 1.32]),
      // Braços da suspensão.
      tube(frame, [side * 0.55, 0.72, -1.15], [side * 0.9, 0.5, -1.15], 0.035),
      tube(frame, [side * 0.55, 0.72, 1.15], [side * 0.9, 0.5, 1.15], 0.035),
    ]),
    tube(frame, [-0.7, 2.28, 0.66], [0.7, 2.28, 0.66]),
    tube(frame, [-0.7, 2.28, 0.95], [0.7, 2.28, 0.95]),
    // Caixa de amostras na traseira.
    box(body, [1.3, 0.32, 0.6], [0, 1.2, 1.42]),
    box(accent, [1.3, 0.04, 0.6], [0, 1.38, 1.42]),
    // Mastro da antena e câmera na frente.
    tube(frame, [0.56, 1.03, 1.22], [0.56, 2.95, 1.22], 0.025),
    tube(frame, [0.62, 1.2, -1.2], [0.62, 1.5, -1.2], 0.02),
    box(frame, [0.14, 0.12, 0.2], [0.62, 1.55, -1.2]),
  ];
  const antenna = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.16, 24, 1, true), dish);
  antenna.position.set(0.56, 3.0, 1.22);
  antenna.rotation.x = Math.PI;
  return [...parts, antenna];
}

/**
 * @param {THREE.Scene} scene
 * @param {{ heightAt: (x: number, z: number) => number }} terrain
 * @returns {{ drive: Function, park: Function, hide: () => void }} `drive` põe o veículo sob o
 *   astronauta (o banco do motorista fica onde a câmera está); `park` o deixa parado ao lado da rota.
 */
export function createVehicle(scene, terrain) {
  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...options });
  const materials = {
    body: material(COLORS.body, { roughness: 0.55 }),
    frame: material(COLORS.frame, { roughness: 0.5, metalness: 0.4 }),
    tire: material(COLORS.tire, { roughness: 0.95 }),
    lug: material(COLORS.lug, { roughness: 0.95 }),
    seat: material(COLORS.seat, { roughness: 0.9 }),
    accent: material(COLORS.accent, { roughness: 0.4, emissive: COLORS.accent, emissiveIntensity: 0.25 }),
    dish: material(COLORS.dish, { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    light: material(COLORS.light, { emissive: COLORS.light, emissiveIntensity: 0.9 }),
  };

  const group = new THREE.Group();
  group.visible = false;
  group.add(...buildBody(materials));

  const wheels = [-1, 1].flatMap((side) => [-1, 1].map((end) => {
    const wheel = createWheel(materials);
    wheel.position.set(side * (VEHICLE.trackM / 2), VEHICLE.wheelRadiusM, end * (VEHICLE.wheelbaseM / 2));
    return wheel;
  }));
  group.add(...wheels);

  // O mapa de sombras do relevo é grosso demais para um veículo de 3 m: uma mancha escura no chão faz o papel.
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.06;
  contact.scale.set(1, 1.5, 1);
  group.add(contact);
  scene.add(group);

  // Apoia o veículo no relevo: altura média das quatro rodas e inclinação de frente/trás e de lado.
  function place(x, z, headingDeg, distM) {
    const forward = { x: Math.sin(headingDeg * DEG), z: -Math.cos(headingDeg * DEG) };
    const right = { x: Math.cos(headingDeg * DEG), z: Math.sin(headingDeg * DEG) };
    const heightAt = (ahead, aside) => terrain.heightAt(x + forward.x * ahead + right.x * aside, z + forward.z * ahead + right.z * aside);
    const front = heightAt(VEHICLE.wheelbaseM / 2, 0);
    const rear = heightAt(-VEHICLE.wheelbaseM / 2, 0);
    const left = heightAt(0, -VEHICLE.trackM / 2);
    const rightSide = heightAt(0, VEHICLE.trackM / 2);
    group.position.set(x, (front + rear + left + rightSide) / 4, z);
    group.rotation.set(Math.atan2(front - rear, VEHICLE.wheelbaseM), -headingDeg * DEG, Math.atan2(rightSide - left, VEHICLE.trackM), 'YXZ');
    for (const wheel of wheels) wheel.rotation.x = -distM / VEHICLE.wheelRadiusM;
    group.visible = true;
  }

  // Desloca um ponto para frente e para a direita do rumo dado.
  const offset = ({ x, z }, headingDeg, aheadM, rightM) => ({
    x: x + Math.sin(headingDeg * DEG) * aheadM + Math.cos(headingDeg * DEG) * rightM,
    z: z - Math.cos(headingDeg * DEG) * aheadM + Math.sin(headingDeg * DEG) * rightM,
  });

  return Object.freeze({
    /** Astronauta dirigindo: o banco do motorista coincide com a posição dele. */
    drive(position, headingDeg, distM) {
      const origin = offset(position, headingDeg, VEHICLE.seat.z, -VEHICLE.seat.x);
      place(origin.x, origin.z, headingDeg, distM);
    },
    /** Astronauta fora do veículo: ele fica parado ao lado do ponto da rota onde foi deixado. */
    park(position, headingDeg, distM) {
      const origin = offset(position, headingDeg, VEHICLE.parked.aheadM, VEHICLE.parked.rightM);
      place(origin.x, origin.z, headingDeg, distM);
    },
    hide() { group.visible = false; },
  });
}
