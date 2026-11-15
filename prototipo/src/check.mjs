// Checagem rápida da matemática de projeção e rota. Rodar com: node prototipo/src/check.mjs
import assert from 'node:assert/strict';
import { ROUTES } from '../data/travessia.js';
import { toLocal, toGeo, headingDeg, angleDeltaDeg } from './geo.js';
import { buildPlan, samplePath, headingAt } from './route.js';
import { createRouter, TRAVEL } from './pathfind.js';
import { createSafety } from './safety.js';
import { createPlanner } from './planner.js';
import { PROTOCOLS, protocolFor } from '../data/protocolos.js';
import { createSimState, advance, jumpTo, deriveReadout } from './simulation.js';
import { SPEED_KMH, STOP_HOURS } from '../data/travessia.js';
import { readFile } from 'node:fs/promises';
import { fmtDuration, fmtDistance } from './format.js';
import { STOPS, TRACK } from '../data/travessia.js';
import { yToElev } from './geo.js';
import { buildHeightField, fieldFromElevation, heightAt, probe } from './heightfield.js';
import { MOSAIC, mosaicPixel, mosaicUv, mosaicCoverage, tileList } from './tiles.js';
import { DATA_BOUNDS } from './geo.js';

// As coords do dado são a rota em grade de 2 m decimada (um ponto a cada ~11 m),
// então a polilinha fica de 3% a 8% mais curta que o len_km medido na grade.
const LENGTH_TOLERANCE = 0.09;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

// Projeção: ida e volta preserva a coordenada.
const point = toLocal(-4.7288545, 137.3836581);
const back = toGeo(point.x, point.z);
near(back.lat, -4.7288545, 1e-9, 'lat ida e volta');
near(back.lon, 137.3836581, 1e-9, 'lon ida e volta');
assert.ok(point.z < 0, 'habitat fica ao norte da origem (z negativo)');

// Rumo: norte, leste, sul, oeste.
near(headingDeg(0, -1), 0, 1e-9, 'norte');
near(headingDeg(1, 0), 90, 1e-9, 'leste');
near(headingDeg(0, 1), 180, 1e-9, 'sul');
near(angleDeltaDeg(350, 10), 20, 1e-9, 'delta angular cruza o norte');

// O comprimento projetado de cada trecho fica logo abaixo do len_km do dado original.
for (const mode of ['walk', 'car']) {
  const source = ROUTES[mode];
  for (const leg of [...source.legs, source.return_base, source.return_ext]) {
    let meters = 0;
    for (let i = 1; i < leg.coords.length; i++) {
      const a = toLocal(...leg.coords[i - 1]);
      const b = toLocal(...leg.coords[i]);
      meters += Math.hypot(b.x - a.x, b.z - a.z);
    }
    const ratio = meters / 1000 / leg.len_km;
    assert.ok(ratio > 1 - LENGTH_TOLERANCE && ratio <= 1, `${mode} ${leg.from}->${leg.to} comprimento: ${ratio}`);
  }
}

// Plano a pé sem extensão: números do artifact original.
const plan = buildPlan('walk', false);
near(plan.stats.outKm, 4.683, 1e-6, 'ida a pé');
near(plan.stats.totalKm, 8.976, 1e-6, 'total a pé');
assert.equal(plan.stops.length, 3);
assert.deepEqual(plan.stops.map((entry) => entry.stop.id), ['1', '2', '3']);
assert.ok(plan.stops.every((entry, i, all) => i === 0 || entry.distM > all[i - 1].distM), 'paradas em ordem');

// Amostragem: começa e termina no habitat, e não sai do caminho.
const start = samplePath(plan.path, 0);
const end = samplePath(plan.path, plan.path.totalM + 500);
near(Math.hypot(end.x - start.x, end.z - start.z), 0, 15, 'retorno fecha no habitat');
near(start.elev, -4144, 1, 'altitude inicial');
assert.ok(headingAt(plan.path, 0) >= 0 && headingAt(plan.path, plan.path.totalM) < 360);

// A distância percorrida no caminho fecha com o len_km do dado, e o tempo a pé sai dela.
near(plan.path.totalM, plan.stats.totalKm * 1000, 1, 'caminho fecha com o total em km');
near(plan.stats.hours, plan.stats.totalKm / SPEED_KMH.walk + 3 * STOP_HOURS, 1e-3, 'tempo a pé');

// Plano de veículo com extensão marca trechos bloqueados, que são feitos a pé e custam mais tempo.
const carPlan = buildPlan('car', true);
assert.equal(carPlan.stats.blockedLegs.length, 2);
assert.ok(carPlan.stats.hours > carPlan.stats.totalKm / SPEED_KMH.car + 5 * STOP_HOURS, 'trecho bloqueado conta como caminhada');

// Simulação: a rota inteira termina no tempo estimado do plano.
const GROUND = { radiation: 27, groundTemp: -19 };
let sim = createSimState();
for (let i = 0; i < 200000 && !sim.finished; i++) sim = advance(plan, sim, 1 / 30);
assert.ok(sim.finished, 'simulação chega ao fim');
near(deriveReadout(plan, sim, GROUND).elapsedH, plan.stats.hours, 1e-6, 'tempo do visor igual ao do plano');
assert.equal(deriveReadout(plan, sim, GROUND).targetBearing, null, 'sem rumo quando já está no habitat');

// Saltar para cima de uma parada não pula a coleta: ela começa no quadro seguinte.
const onStop = advance(plan, jumpTo(plan, createSimState(), plan.stops[0].distM), 1 / 30);
assert.equal(onStop.stopsReached, 1);
near(onStop.dwellRemainingH, STOP_HOURS, 1e-9, 'coleta começa ao chegar na parada');
assert.equal(deriveReadout(plan, onStop, GROUND).target.kind, 'dwell');

// O plano a pé com extensão não cabe na autonomia de oxigênio.
const longWalk = buildPlan('walk', true);
const longWalkPlan = longWalk;
const longStart = deriveReadout(longWalk, createSimState(), GROUND);
assert.ok(longStart.suit.marginH < 0, 'margem negativa no plano longo a pé');
assert.ok(longStart.alerts.some((alert) => alert.kind === 'o2-short'), 'alerta de oxigênio insuficiente');
assert.throws(() => buildPlan('foguete', false));

// Relevo ilustrativo: perto das âncoras, a altitude fica próxima da real.
const ANCHOR_TOLERANCE_M = 12;
const field = buildHeightField();
for (const stop of STOPS) {
  const local = toLocal(stop.lat, stop.lon);
  near(yToElev(heightAt(field, local.x, local.z)), stop.el, ANCHOR_TOLERANCE_M, `altitude na parada ${stop.id}`);
}
const reading = probe(field, 0, 0);
assert.ok(reading.slopeDeg >= 0 && reading.slopeDeg < 60, 'declive plausível');
// Radiação e temperatura vêm das medições do Curiosity (data/medicoes.js), não de fórmula inventada.
{
  const { RAD, REMS } = await import('../data/medicoes.js');
  const { estimatedAirTempC, estimatedGroundTempC } = await import('./clima.js');
  near(reading.radiation, 27.9, 0.05, 'leitura de radiação é a média medida pelo RAD (0,67 mSv/dia)');
  assert.equal(reading.groundTemp, undefined, 'não há mais temperatura do solo inventada por ponto');
  near(estimatedAirTempC(6), REMS.air.minC, 1e-9, 'ar mais frio no nascer do Sol');
  near(estimatedAirTempC(15), REMS.air.maxC, 1e-9, 'ar mais quente no meio da tarde');
  near(estimatedGroundTempC(13), REMS.ground.maxC, 1e-9, 'solo mais quente no começo da tarde');
  for (let hour = 0; hour <= 24; hour += 0.5) {
    assert.ok(estimatedAirTempC(hour) >= REMS.air.minC - 1e-9 && estimatedAirTempC(hour) <= REMS.air.maxC + 1e-9, 'ar dentro da faixa medida');
    assert.ok(estimatedGroundTempC(hour) >= REMS.ground.minC - 1e-9 && estimatedGroundTempC(hour) <= REMS.ground.maxC + 1e-9, 'solo dentro da faixa medida');
  }
  near(estimatedAirTempC(0), estimatedAirTempC(24), 1e-9, 'a curva fecha em um sol');
  assert.equal(RAD.solarEventFactor, 2, 'evento solar no valor medido em 2017');
}

// Relevo real: a grade extraída do DEM do USGS bate com as altitudes das paradas e do trajeto do Curiosity.
const REAL_TOLERANCE_M = 4;
const elevationDir = new URL('../assets/elevation/', import.meta.url);
const meta = await readFile(new URL('monte-sharp.json', elevationDir), 'utf8').then(JSON.parse).catch(() => null);
if (meta) {
  const bytes = await readFile(new URL(meta.file, elevationDir));
  const packed = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const real = fieldFromElevation(meta, packed);
  assert.ok(real.isReal && real.cellM === meta.cellM);
  for (const stop of STOPS) {
    const local = toLocal(stop.lat, stop.lon);
    near(yToElev(heightAt(real, local.x, local.z)), stop.el, REAL_TOLERANCE_M, `altitude real na parada ${stop.id}`);
  }
  const errors = TRACK.map(([lat, lon, elev]) => {
    const local = toLocal(lat, lon);
    return Math.abs(yToElev(heightAt(real, local.x, local.z)) - elev);
  });
  const meanError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  assert.ok(meanError < 1.5, `erro médio no trajeto do Curiosity: ${meanError.toFixed(2)} m`);
  assert.throws(() => fieldFromElevation({ ...meta, halfWidthM: 1 }, packed), 'recusa grade de outra janela');

  // Rota calculada sobre o relevo real: chega ao destino, respeita o limite de declive
  // e fica na mesma ordem de grandeza da rota pré-calculada em 2 m.
  const router = createRouter(real);
  const localOf = (id) => { const stop = STOPS.find((entry) => entry.id === id); return toLocal(stop.lat, stop.lon); };
  for (const mode of ['walk', 'car']) {
    const reference = ROUTES[mode].legs[1];
    const found = router.findPath(localOf('1'), localOf('2'), TRAVEL[mode]);
    assert.ok(found.reachable, `rota ${mode} 1->2 encontrada`);
    assert.ok(found.maxSlopeDeg <= TRAVEL[mode].maxSlopeDeg, `rota ${mode} respeita o declive máximo`);
    near(found.lengthM / 1000 / reference.len_km, 1, 0.25, `comprimento da rota ${mode} 1->2 contra a pré-calculada`);
    assert.ok(found.hours > found.lengthM / 1000 / TRAVEL[mode].speedKmh / 1.3, 'tempo coerente com a velocidade do modo');
  }
  assert.equal(router.findPath(localOf('H'), { x: 3000, z: 4000 }, { ...TRAVEL.car, maxSlopeDeg: 0.01 }).reachable, false, 'declive impossível dá rota inalcançável');

  // Segurança: volta a pé cresce com a distância; o habitat enxerga a si mesmo.
  const safety = createSafety(real, router);
  near(safety.walkBackAt(safety.habitat.x, safety.habitat.z), 0, 0.02, 'volta a pé a partir do habitat');
  const backFrom = (id) => { const local = localOf(id); return safety.walkBackAt(local.x, local.z); };
  assert.ok(backFrom('1') < backFrom('2') && backFrom('2') < backFrom('3') && backFrom('3') < backFrom('5'), 'volta a pé cresce com a distância');
  near(backFrom('3'), ROUTES.walk.return_base.len_km / SPEED_KMH.walk, 0.6, 'volta a pé da parada 3 perto do retorno pré-calculado');
  assert.equal(safety.commsAt(safety.habitat.x + 20, safety.habitat.z).visible, true, 'rádio ao lado do habitat');
  const baseSafety = safety.assessPlan(plan);
  assert.equal(baseSafety.noReturn, null, 'plano a pé básico não tem ponto sem volta');
  assert.ok(safety.assessPlan(longWalkPlan).noReturn, 'plano a pé com extensão tem ponto sem volta');
  assert.ok(baseSafety.commsGaps.every((gap) => gap.toM > gap.fromM), 'trechos sem rádio bem formados');
  assert.ok(baseSafety.shelter.habitat.walkH > 0);

  // Radiação estimada: nunca acima da média do RAD, nunca abaixo dela menos 4%, e menor onde o relevo tapa o céu.
  {
    const { RAD } = await import('../data/medicoes.js');
    let lowest = Infinity;
    let highest = -Infinity;
    for (let x = -3000; x <= 3000; x += 250) {
      for (let z = -4000; z <= 4000; z += 250) {
        const value = safety.radiationAt(x, z);
        lowest = Math.min(lowest, value);
        highest = Math.max(highest, value);
      }
    }
    assert.ok(highest <= RAD.surfaceUsvPerHour + 1e-9, 'radiação não passa da média medida');
    assert.ok(lowest > RAD.surfaceUsvPerHour * 0.8, 'blindagem do relevo fica em poucos por cento, como na medição de Murray Buttes');
    assert.ok(highest - lowest > 0.05, 'o relevo muda a estimativa de um ponto para outro');
  }

  // Destino livre: plano no mesmo formato dos pré-calculados, e simulação roda nele.
  const planner = createPlanner(real, router, safety);
  const custom = planner.planThrough([localOf('2')], 'walk');
  assert.ok(custom.plan && custom.plan.isCustom && custom.plan.stops[0].stop.id === 'A');
  near(custom.plan.path.totalM / 1000, custom.plan.stats.totalKm, 0.01, 'caminho do destino livre fecha com o total');
  // O tempo do plano é o do roteador (com declive), não distância dividida pela velocidade no plano.
  const routed = router.findPath(localOf('H'), localOf('2'), planner.profileFor('walk'));
  const routedBack = router.findPath(localOf('2'), localOf('H'), planner.profileFor('walk'));
  assert.ok(routed.hours >= router.findPath(localOf('H'), localOf('2'), TRAVEL.walk).hours - 1e-9, 'a rota mais segura não é mais rápida que a mais rápida');
  near(custom.plan.path.totalTravelH, routed.hours + routedBack.hours, 0.02, 'tempo do destino livre igual ao do roteador');
  assert.ok(custom.plan.stats.maxSlopeDeg <= TRAVEL.walk.maxSlopeDeg, 'rota desenhada respeita o declive máximo');
  assert.equal(planner.planThrough([{ x: safety.habitat.x + 3, z: safety.habitat.z }], 'walk').plan, null, 'ponto colado no habitat é recusado');
  let customSim = createSimState();
  for (let i = 0; i < 200000 && !customSim.finished; i++) customSim = advance(custom.plan, customSim, 1 / 30);
  assert.ok(customSim.finished, 'simulação termina no plano de destino livre');
  assert.equal(deriveReadout(custom.plan, createSimState(), GROUND).target.name, 'Ponto A');
  assert.ok(planner.planThrough([localOf('2')], 'car').plan, 'rota livre de veículo encontra rota');

  // Rota livre com vários pontos: habitat, A, B, C e volta, sem saltos entre os trechos.
  const multi = planner.planThrough([localOf('1'), localOf('2'), localOf('3')], 'walk');
  assert.deepEqual(multi.plan.stops.map((entry) => entry.stop.id), ['A', 'B', 'C']);
  assert.deepEqual([...multi.plan.legs, multi.plan.returnLeg].map((leg) => `${leg.from}>${leg.to}`), ['H>A', 'A>B', 'B>C', 'C>H']);
  assert.ok(multi.plan.stops.every((entry, i, all) => i === 0 || entry.distM > all[i - 1].distM), 'pontos em ordem ao longo da rota');
  near(multi.plan.path.totalM / 1000, multi.plan.stats.totalKm, 0.01, 'caminho da rota livre fecha com o total');
  assert.ok(multi.plan.path.points.every((point, i, all) => i === 0 || Math.hypot(point.x - all[i - 1].x, point.z - all[i - 1].z) < 60), 'sem saltos entre trechos');
  assert.ok(multi.plan.stats.hours > custom.plan.stats.hours, 'três pontos levam mais tempo que um');
  assert.equal(planner.planThrough(Array.from({ length: 14 }, () => localOf('1')), 'walk').plan, null, 'acima do limite de pontos é recusado');
  assert.equal(planner.planThrough([localOf('1'), localOf('1')], 'walk').plan, null, 'ponto repetido em seguida é recusado');
} else {
  process.stdout.write('aviso: grade de altitude real ausente, relevo real não conferido\n');
}

// Mosaico da imagem orbital: a área de dados cai inteira dentro dos ladrilhos baixados.
assert.equal(tileList().length, MOSAIC.cols * MOSAIC.rows);
for (const [lat, lon] of [[DATA_BOUNDS.north, DATA_BOUNDS.west], [DATA_BOUNDS.south, DATA_BOUNDS.east]]) {
  const { px, py } = mosaicPixel(lat, lon);
  assert.ok(px > 0 && px < MOSAIC.cols * MOSAIC.tilePx, `px dentro do mosaico: ${px}`);
  assert.ok(py > 0 && py < MOSAIC.rows * MOSAIC.tilePx, `py dentro do mosaico: ${py}`);
  assert.equal(mosaicCoverage(lat, lon, 100), 1);
}
const northUv = mosaicUv(DATA_BOUNDS.north, DATA_BOUNDS.west);
const southUv = mosaicUv(DATA_BOUNDS.south, DATA_BOUNDS.east);
assert.ok(northUv.v > southUv.v && southUv.u > northUv.u, 'norte fica em cima e leste à direita na textura');
assert.equal(mosaicCoverage(-4.6, 137.39, 100), 0, 'longe da foto não há cobertura');

// Protocolos: todos têm passos, abrigo e fonte declarada.
assert.ok(PROTOCOLS.length >= 8 && PROTOCOLS.every((entry) => entry.steps.length >= 3 && entry.source && entry.shelter));
assert.equal(protocolFor('radio').id, 'radio');
assert.ok(PROTOCOLS.every((entry) => entry.evidence.length >= 1 && entry.evidence.every((fact) => fact.url.startsWith('https://') && fact.label && fact.text)), 'todo protocolo tem fato com fonte');
assert.throws(() => protocolFor('inexistente'));

assert.equal(fmtDuration(1.5), '1h30');
assert.equal(fmtDuration(-0.25), '-0h15');
assert.equal(fmtDistance(1840), '1,84 km');
assert.equal(fmtDistance(124), '120 m');


// Ortofoto de 25 cm e mosaico do Mars Trek: a conversão entre coordenada e pixel vai e volta,
// as duas grades concordam no tamanho do chão, e o PackBits descomprime cópias e repetições.
{
  const { orthoPixelAt, orthoGeoAt, unpackBits } = await import('./ortofoto.js');
  const { trekPixelAt, trekGeoAt } = await import('./trek.js');
  for (const [pixelAt, geoAt] of [[orthoPixelAt, orthoGeoAt], [trekPixelAt, trekGeoAt]]) {
    const { px, py } = pixelAt(-4.77, 137.394);
    const back = geoAt(px, py);
    near(back.lat, -4.77, 1e-9, 'latitude vai e volta');
    near(back.lon, 137.394, 1e-9, 'longitude vai e volta');
    assert.ok(pixelAt(-4.76, 137.394).py < py && pixelAt(-4.77, 137.4).px > px, 'norte sobe e leste avança');
  }
  const ortho = orthoPixelAt(-4.77, 137.394);
  assert.ok(ortho.px > 0 && ortho.px < 180000 && ortho.py > 0 && ortho.py < 280000, 'área de estudo dentro da ortofoto');
  const spanOrtho = orthoPixelAt(-4.78, 137.394).py - ortho.py;
  const spanTrek = trekPixelAt(-4.78, 137.394).py - trekPixelAt(-4.77, 137.394).py;
  near((spanOrtho * 0.25) / spanTrek, 0.636, 0.002, 'Mars Trek no nível 16 tem cerca de 64 cm por pixel');
  assert.deepEqual([...unpackBits(Uint8Array.from([2, 7, 8, 9, 0xfd, 5, 0x80, 0, 1]), 8)], [7, 8, 9, 5, 5, 5, 5, 1]);
}

// Sol em Marte: o exemplo publicado do Mars24 (6 de janeiro de 2000, 0h UTC) e a geometria do céu.
{
  const { solarLongitudeDeg, sunAt, daylightHours, localSolarHour, compassName } = await import('./luz.js');
  near(solarLongitudeDeg(2451549.50074), 277.18758, 0.01, 'Ls do exemplo do Mars24');
  const noon = sunAt(-4.77, 277.19, 12);
  near(noon.elevationDeg, 90 - Math.abs(-4.77 - (-24.8)), 0.6, 'Sol do meio-dia: 90° menos a distância entre latitude e declinação');
  near(noon.azimuthDeg, 180, 0.01, 'no verão do sul o Sol do meio-dia fica ao sul de Gale');
  const morning = sunAt(-4.77, 0, 8);
  assert.ok(morning.direction[0] > 0 && morning.elevationDeg > 0 && morning.elevationDeg < 90, 'de manhã o Sol está a leste e acima do horizonte');
  near(Math.hypot(...morning.direction), 1, 1e-9, 'direção do Sol é vetor unitário');
  assert.equal(compassName(morning.azimuthDeg), 'leste');
  assert.ok(sunAt(-4.77, 0, 0).elevationDeg < -80, 'à meia-noite o Sol está do outro lado');
  const day = daylightHours(-4.77, 0);
  near(day.sunriseH, 6, 0.01, 'no equinócio o Sol nasce às 6h');
  near(sunAt(-4.77, 123, daylightHours(-4.77, 123).sunsetH).elevationDeg, 0, 0.01, 'no pôr do Sol a altura é zero');
  near(localSolarHour(10, 24.6598), 34, 0.001, 'um sol (24h39min da Terra) depois, a hora local é a mesma');
  assert.ok(deriveReadout({ ...plan, startClockH: 14 }, createSimState(), GROUND).clockH === 14, 'o relógio do visor parte da hora escolhida no tablet');
}

// Areia escura estimada: a rota que conhece a areia passa menos por ela, sem deixar de chegar.
{
  const { readFile: read } = await import('node:fs/promises');
  const { decodeSand } = await import('./areia.js');
  const { createSafety: safetyFor } = await import('./safety.js');
  const { createPlanner: plannerFor } = await import('./planner.js');
  const { toLocal: local } = await import('./geo.js');
  const { buildPlan: fixedPlan } = await import('./route.js');
  const dir = new URL('../assets/', import.meta.url);
  const meta = JSON.parse(await read(new URL('elevation/monte-sharp.json', dir), 'utf8'));
  const bytes = await read(new URL(`elevation/${meta.file}`, dir));
  const real = fieldFromElevation(meta, new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  const sand = decodeSand(new Uint8Array(await read(new URL('areia/areia.bits', dir))), real.heights.length);
  assert.ok(sand, 'o arquivo da areia tem um bit por célula da grade do relevo');
  assert.equal(decodeSand(new Uint8Array(3), real.heights.length), null, 'arquivo de outra grade é recusado');
  const aware = createRouter(real, { sand });
  const blind = createRouter(real);
  assert.ok(aware.hasSand && !blind.hasSand && !blind.sandAt(0, 0), 'sem o arquivo, o roteador não vê areia');
  const measure = safetyFor(real, aware);
  const stops = fixedPlan('walk', false).stops.map(({ stop }) => local(stop.lat, stop.lon));
  const sandOn = (router) => {
    const result = plannerFor(real, router, safetyFor(real, router)).planThrough(stops, 'walk');
    assert.ok(result.plan, 'a rota pelas paradas continua existindo');
    return measure.assessPlan(result.plan).sandM;
  };
  const [withSand, without] = [sandOn(aware), sandOn(blind)];
  assert.ok(withSand < without * 0.75, `a rota que conhece a areia cruza menos areia (${withSand.toFixed(0)} m contra ${without.toFixed(0)} m)`);
}

process.stdout.write('ok: projeção, rotas, areia e formatação conferidas\n');
