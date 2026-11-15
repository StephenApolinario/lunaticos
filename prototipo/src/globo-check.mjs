// Checagem da matemática do globo. Rodar com: node prototipo/src/globo-check.mjs
import assert from 'node:assert/strict';
import { DATA_BOUNDS, MARS_RADIUS_M, toLocal } from './geo.js';
import {
  DEG, wrapLon, tileGrid, sphereFromGeo, geoFromSphere, angleBetween, tileAt, tileBounds, tilesInRect,
  centeredBounds, isInsideArea, areaCenter, levelForView, groundAngle, enuAxes, poseFromView, projectPoint, surfaceUnder,
} from './globo-geo.js';

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const WHOLE = Object.freeze({ south: -90, north: 90, west: -180, east: 180 });

// Ladrilhos conferidos no servidor do Mars Trek para o ponto da Cratera Gale (nível/linha/coluna).
for (const [level, row, col] of [[3, 4, 14], [5, 16, 56], [6, 33, 112], [7, 67, 225]]) {
  assert.deepEqual(tileAt(-4.8, 137.4, level), { row, col }, `ladrilho do nível ${level}`);
  assert.ok(isInsideArea(-4.8, 137.4, tileBounds(level, row, col)), `o ladrilho ${level}/${row}/${col} contém o ponto`);
}

// Cantos e emendas da grade: polo norte na linha 0, 180° oeste na coluna 0, e 180° leste é o mesmo meridiano.
assert.deepEqual(tileGrid(7), { rows: 128, cols: 256 });
assert.deepEqual(tileAt(90, -180, 0), { row: 0, col: 0 });
assert.deepEqual(tileAt(0, 0, 0), { row: 0, col: 1 });
assert.deepEqual(tileAt(-90, 179.999, 4), { row: 15, col: 31 });
assert.deepEqual(tileAt(10, 180, 4), tileAt(10, -180, 4), '180° leste e oeste');
assert.deepEqual(tileAt(-4.8, 137.4 - 360, 7), { row: 67, col: 225 }, 'longitude com uma volta a menos');
near(wrapLon(497.4), 137.4, 1e-9, 'longitude com uma volta a mais');
assert.equal(wrapLon(180), -180);
assert.deepEqual(tileBounds(0, 0, 1), { north: 90, south: -90, west: 0, east: 180 });

// Lista de ladrilhos: o planeta inteiro, um ladrilho só e os filhos dele dois níveis abaixo.
assert.equal(tilesInRect(WHOLE, 2).length, 32);
assert.equal(tilesInRect(WHOLE, 3).length, 128);
assert.deepEqual(tilesInRect(WHOLE, 1)[0], { row: 0, col: 0 });
assert.deepEqual(tilesInRect(WHOLE, 1).at(-1), { row: 1, col: 3 });
assert.deepEqual(tilesInRect(tileBounds(5, 16, 56), 5), [{ row: 16, col: 56 }], 'borda na divisa não puxa o vizinho');
const children = tilesInRect(tileBounds(5, 16, 56), 7);
assert.equal(children.length, 16);
assert.deepEqual(children[0], { row: 64, col: 224 });
assert.deepEqual(children.at(-1), { row: 67, col: 227 });
assert.deepEqual(tilesInRect(DATA_BOUNDS, 7), [{ row: 67, col: 225 }], 'a área mapeada cabe num ladrilho do nível 7');

// Esfera: eixos, ida e volta e a mesma orientação da SphereGeometry do Three.
const axis = (lat, lon, expected) => {
  const point = sphereFromGeo(lat, lon);
  for (const key of ['x', 'y', 'z']) near(point[key], expected[key], 1e-12, `eixo ${key} em ${lat}, ${lon}`);
};
axis(0, 0, { x: 1, y: 0, z: 0 });
axis(90, 0, { x: 0, y: 1, z: 0 });
axis(0, 90, { x: 0, y: 0, z: -1 });
for (const [lat, lon] of [[-4.77, 137.394], [62.5, -171.25], [-88, 12], [0, 179.5], [33, -0.001]]) {
  const point = sphereFromGeo(lat, lon);
  near(Math.hypot(point.x, point.y, point.z), 1, 1e-12, 'raio 1');
  const back = geoFromSphere(point.x * 3.2, point.y * 3.2, point.z * 3.2);
  near(back.lat, lat, 1e-9, 'lat ida e volta');
  near(back.lon, lon, 1e-9, 'lon ida e volta');
  // Vértice da SphereGeometry em (u, v), com u a partir de 180° oeste e v a partir do polo norte.
  const phi = ((lon + 180) / 360) * 2 * Math.PI;
  const theta = ((90 - lat) / 180) * Math.PI;
  near(point.x, -Math.cos(phi) * Math.sin(theta), 1e-12, 'x como no Three');
  near(point.y, Math.cos(theta), 1e-12, 'y como no Three');
  near(point.z, Math.sin(phi) * Math.sin(theta), 1e-12, 'z como no Three');
}
assert.throws(() => geoFromSphere(0, 0, 0), /centro/);
near(angleBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }), Math.PI / 2, 1e-12, 'um quarto de volta');
near(angleBetween({ lat: 90, lon: 0 }, { lat: -90, lon: 77 }), Math.PI, 1e-12, 'polo a polo');

// Área mapeada.
const center = areaCenter(DATA_BOUNDS);
near(center.lat, -4.77, 1e-9, 'centro lat');
near(center.lon, 137.394, 1e-9, 'centro lon');
assert.ok(isInsideArea(center.lat, center.lon, DATA_BOUNDS));
assert.ok(isInsideArea(center.lat, center.lon - 360, DATA_BOUNDS), 'longitude com uma volta a menos');
assert.ok(isInsideArea(DATA_BOUNDS.south, DATA_BOUNDS.west, DATA_BOUNDS), 'a borda conta');
assert.ok(!isInsideArea(-4.83, center.lon, DATA_BOUNDS), 'ao sul');
assert.ok(!isInsideArea(center.lat, 137.42, DATA_BOUNDS), 'a leste');
assert.ok(!isInsideArea(-center.lat, center.lon, DATA_BOUNDS), 'outro hemisfério');

// Retalhos em volta da área: alinhados à grade, do tamanho pedido e contendo a área inteira.
for (const level of [5, 6, 7]) {
  for (const count of [3, 4, 6]) {
    const bounds = centeredBounds(center.lat, center.lon, level, count);
    assert.equal(tilesInRect(bounds, level).length, count * count, `retalho ${count}×${count} no nível ${level}`);
    near(bounds.east - bounds.west, (count * 360) / tileGrid(level).cols, 1e-9, 'largura do retalho');
    for (const [lat, lon] of [[DATA_BOUNDS.south, DATA_BOUNDS.west], [DATA_BOUNDS.north, DATA_BOUNDS.east]]) {
      assert.ok(isInsideArea(lat, lon, bounds), `retalho do nível ${level} contém a área`);
    }
  }
}
// Perto do polo e num nível com poucas linhas, o bloco encosta na borda da grade em vez de sair dela.
assert.equal(centeredBounds(89, 10, 3, 3).north, 90);
assert.deepEqual(centeredBounds(0, 0, 1, 5), { north: 90, south: -90, west: -90, east: 90 });

// Nível pedido pela tela: 40° de campo e 1000 px de altura a um raio de altitude pedem o nível 5.
const FOV = 40 * DEG;
assert.equal(levelForView(1, FOV, 1000), 5);
assert.equal(levelForView(1, FOV, 2000), 6, 'tela com o dobro de pixels pede um nível a mais');
assert.equal(levelForView(1000, FOV, 1000), 0, 'nunca abaixo do nível 0');
let previous = 0;
for (const altitude of [5, 2, 1, 0.5, 0.2, 0.05, 0.02]) {
  const level = levelForView(altitude, FOV, 1000);
  assert.ok(level >= previous, `o nível não cai ao aproximar (${altitude})`);
  previous = level;
}

// Chão à vista: perto do chão vale altitude × ângulo; passando da borda do planeta, vale o horizonte.
near(groundAngle(0.01, 0.2), 0.01 * Math.tan(0.2), 2e-5, 'ângulo pequeno');
near(groundAngle(1, 0), 0, 1e-12, 'no nadir');
near(groundAngle(1, 1.2), Math.acos(1 / 2), 1e-12, 'horizonte a um raio de altitude');
assert.ok(groundAngle(0.5, 0.3) < groundAngle(0.5, 0.6), 'cresce com o ângulo');

// Eixos locais: unitários, perpendiculares e na ordem leste × norte = para cima.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaled = ({ x, y, z }, k = MARS_RADIUS_M) => [x * k, y * k, z * k];
for (const [lat, lon] of [[-4.77, 137.394], [48, -120], [0, 0]]) {
  const { east, north, up } = enuAxes(lat, lon);
  const point = sphereFromGeo(lat, lon);
  near(dot(up, [point.x, point.y, point.z]), 1, 1e-12, 'para cima é a direção do ponto');
  near(dot(east, north), 0, 1e-12, 'leste ⟂ norte');
  near(dot(east, up), 0, 1e-12, 'leste ⟂ cima');
  near(east[1] * north[2] - east[2] * north[1], up[0], 1e-12, 'leste × norte = cima');
  near(dot(north, [0, 1, 0]), Math.cos(lat * DEG), 1e-12, 'norte aponta para o polo');
}

// Vista → câmera. Olhando reto para baixo com o norte para cima: câmera na vertical do ponto, leste à direita.
const TAN_HALF = Math.tan(20 * DEG);
const ASPECT = 1.6;
const top = poseFromView({ lat: center.lat, lon: center.lon, distanceM: 20000 });
const axes = enuAxes(center.lat, center.lon);
near(Math.hypot(...top.position), MARS_RADIUS_M + 20000, 1e-6, 'altura da câmera na vertical');
for (let i = 0; i < 3; i++) {
  near(top.right[i], axes.east[i], 1e-12, 'direita = leste');
  near(top.up[i], axes.north[i], 1e-12, 'para cima = norte');
  near(top.back[i], axes.up[i], 1e-12, 'para trás = para cima do chão');
}
// Em qualquer rumo e inclinação o ponto olhado fica no centro da tela, à distância pedida, e o raio do centro volta nele.
const target = scaled(sphereFromGeo(center.lat, center.lon));
for (const view of [
  { lat: center.lat, lon: center.lon, distanceM: 150, headingDeg: 0, tiltDeg: 85 },
  { lat: center.lat, lon: center.lon, distanceM: 20000, headingDeg: 215, tiltDeg: 60 },
  { lat: center.lat, lon: center.lon, distanceM: 9e6, headingDeg: 0, tiltDeg: 0 },
  { lat: center.lat, lon: center.lon, distanceM: 4000, headingDeg: 90, tiltDeg: 0 },
]) {
  const pose = poseFromView(view);
  const label = `vista a ${view.distanceM} m, rumo ${view.headingDeg}°, inclinação ${view.tiltDeg}°`;
  near(dot(pose.right, pose.up), 0, 1e-12, `${label}: eixos perpendiculares`);
  near(dot(pose.up, pose.back), 0, 1e-12, `${label}: eixos perpendiculares`);
  near(Math.hypot(...pose.position.map((value, i) => value - target[i])), view.distanceM, 1e-6, `${label}: distância`);
  // Lei dos cossenos no triângulo centro do planeta, ponto olhado e câmera.
  const fromCenter = Math.sqrt(MARS_RADIUS_M ** 2 + view.distanceM ** 2 + 2 * MARS_RADIUS_M * view.distanceM * Math.cos(view.tiltDeg * DEG));
  near(Math.hypot(...pose.position), fromCenter, 1e-6, `${label}: distância ao centro do planeta`);
  const onScreen = projectPoint(pose, target, TAN_HALF, ASPECT);
  assert.ok(onScreen.inFront, `${label}: ponto olhado à frente`);
  near(onScreen.x, 0, 1e-9, `${label}: centro em x`);
  near(onScreen.y, 0, 1e-9, `${label}: centro em y`);
  const under = surfaceUnder(pose, 0, 0, TAN_HALF, ASPECT);
  const back = geoFromSphere(under.x, under.y, under.z);
  near(back.lat, center.lat, 1e-9, `${label}: raio do centro volta na latitude`);
  near(back.lon, center.lon, 1e-9, `${label}: raio do centro volta na longitude`);
}
// Rumo: com o norte para cima, um ponto ao norte sobe na tela; com o leste para cima (90°), o norte vai para a esquerda.
const northOf = scaled(sphereFromGeo(center.lat + 0.02, center.lon));
const northUp = projectPoint(top, northOf, TAN_HALF, ASPECT);
assert.ok(northUp.y > 0.05 && Math.abs(northUp.x) < 1e-9, 'norte para cima');
const eastUp = projectPoint(poseFromView({ lat: center.lat, lon: center.lon, distanceM: 20000, headingDeg: 90 }), northOf, TAN_HALF, ASPECT);
assert.ok(eastUp.x < -0.03 && Math.abs(eastUp.y) < 1e-9, 'com o leste para cima, o norte fica à esquerda');
// Inclinada, a câmera vê o horizonte: no alto da tela a visada passa por fora do planeta.
const low = poseFromView({ lat: center.lat, lon: center.lon, distanceM: 150, tiltDeg: 85 });
assert.equal(surfaceUnder(low, 0, 1, TAN_HALF, ASPECT), null, 'acima do horizonte');
assert.ok(surfaceUnder(low, 0, -1, TAN_HALF, ASPECT), 'abaixo do horizonte');
// Ida e volta tela → chão → tela, e o mesmo chão do modelo local: os cantos da área caem na tela onde a
// projeção plana de geo.js os põe (o plano tangente difere da esfera em menos de um metro nesta distância).
const pose = poseFromView({ lat: center.lat, lon: center.lon, distanceM: 20000, headingDeg: 30, tiltDeg: 40 });
const under = surfaceUnder(pose, 0.4, -0.3, TAN_HALF, ASPECT);
const again = projectPoint(pose, scaled(under), TAN_HALF, ASPECT);
near(again.x, 0.4, 1e-9, 'tela → chão → tela em x');
near(again.y, -0.3, 1e-9, 'tela → chão → tela em y');
for (const [lat, lon] of [[DATA_BOUNDS.south, DATA_BOUNDS.west], [DATA_BOUNDS.north, DATA_BOUNDS.east], [DATA_BOUNDS.north, DATA_BOUNDS.west]]) {
  const { x, z } = toLocal(lat, lon);
  const flat = [0, 1, 2].map((i) => target[i] + axes.east[i] * x - axes.north[i] * z);
  const onGlobe = projectPoint(top, scaled(sphereFromGeo(lat, lon)), TAN_HALF, ASPECT);
  const onPlane = projectPoint(top, flat, TAN_HALF, ASPECT);
  near(onGlobe.x, onPlane.x, 2e-4, 'canto da área: globo e modelo local em x');
  near(onGlobe.y, onPlane.y, 2e-4, 'canto da área: globo e modelo local em y');
}

process.stdout.write('ok: ladrilhos, esfera, área mapeada, retalhos, nível pedido pela tela e câmera da vista conferidos\n');
