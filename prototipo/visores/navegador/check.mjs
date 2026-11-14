// Checagem da matemática do visor navegador. Rodar com: node prototipo/visores/navegador/check.mjs
// Usa a grade de altitude real (assets/elevation) quando ela existe; senão, o relevo aproximado.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROUTES } from '../../data/travessia.js';
import { toLocal } from '../../src/geo.js';
import { buildPlan, buildPlanFromLegs, legFromPoints, registerStop } from '../../src/route.js';
import { buildHeightField, fieldFromElevation, heightAt, probe } from '../../src/heightfield.js';
import { lineOfSight, ANTENNA_M } from './radio.js';
import { groundAttitude, slopeAlongHeading, slopeLevel, paceFactor, projectOnRoute, hazardStatus } from './terreno.js';
import { analyzePlan, routeAt, radioAhead, nextManeuver, slopeAhead } from './analise.js';
import { createNavState, patchState, advance, jumpTo, setFree, elapsedH } from './sim.js';
import { deriveReadout, radioReading } from './leitura.js';
import { buildGuidance } from './assistente.js';

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

// --- Rádio: um morro no meio bloqueia; antena mais alta passa por cima. ---
const flat = () => 0;
const hill = (x) => (Math.abs(x - 500) < 50 ? 20 : 0);
const a = { x: 0, z: 0, antennaM: 2 };
const b = { x: 1000, z: 0, antennaM: 10 };
assert.equal(lineOfSight(flat, a, b).visible, true, 'terreno plano tem visada');
const blocked = lineOfSight(hill, a, b);
assert.equal(blocked.visible, false, 'morro bloqueia');
near(blocked.blockAtM, 500, 60, 'bloqueio no morro');
assert.equal(lineOfSight(hill, { ...a, antennaM: 40 }, { ...b, antennaM: 40 }).visible, true, 'antena alta passa');
// Curvatura: em 20 km de terreno plano, antenas de 2 m não se veem (abaulamento de ~15 m).
assert.equal(lineOfSight(flat, a, { x: 20000, z: 0, antennaM: 2 }, { stepM: 100 }).visible, false, 'curvatura de Marte');

// --- Inclinação: rampa de 10% subindo para o norte. ---
const ramp = (x, z) => -z * 0.1;
const north = groundAttitude(ramp, 0, 0, 0, 4);
near(north.pitchDeg, Math.atan(0.1) * 180 / Math.PI, 1e-6, 'subida de frente');
near(north.rollDeg, 0, 1e-6, 'sem tombo de frente');
const east = groundAttitude(ramp, 0, 0, 90, 4);
near(east.pitchDeg, 0, 1e-6, 'de lado não sobe');
// Indo para leste, o norte (mais alto) fica à esquerda: o chão cai para a direita, tombo positivo.
near(east.rollDeg, Math.atan(0.1) * 180 / Math.PI, 1e-6, 'tombo para a direita');
near(slopeAlongHeading(ramp, 0, 0, 180, 60, 10).deg, -Math.atan(0.1) * 180 / Math.PI, 1e-6, 'descida para o sul');
assert.equal(slopeLevel(9, 20), 'ok');
assert.equal(slopeLevel(12, 20), 'attention');
assert.equal(slopeLevel(16, 20), 'near');
assert.equal(slopeLevel(21, 20), 'over');
assert.ok(paceFactor(15, true) < paceFactor(0, true) && paceFactor(-5, true) > 1 && paceFactor(-20, true) < 1, 'ritmo a pé');
assert.equal(paceFactor(0, false), 1);

// --- Relevo: real se o arquivo existir. ---
const root = new URL('../../', import.meta.url);
let field;
try {
  const meta = JSON.parse(await readFile(new URL('assets/elevation/monte-sharp.json', root), 'utf8'));
  const buffer = await readFile(new URL(`assets/elevation/${meta.file}`, root));
  field = fieldFromElevation(meta, new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2));
} catch {
  field = buildHeightField();
}
const terrain = { heightAt: (x, z) => heightAt(field, x, z), probe: (x, z) => probe(field, x, z) };

for (const [mode, extension] of [['walk', false], ['walk', true], ['car', false], ['car', true]]) {
  const label = `${mode}${extension ? '+ext' : ''}`;
  const plan = buildPlan(mode, extension);
  const analysis = analyzePlan(plan, terrain);

  // Tabelas: monotônicas, e o ritmo simulado fica a até 25% do tempo do plano.
  for (let i = 1; i < analysis.count; i++) assert.ok(analysis.paceH[i] > analysis.paceH[i - 1], `${label} ritmo cresce`);
  near(analysis.paceTotalH / plan.path.totalTravelH, 1, 0.25, `${label} ritmo perto do plano`);
  near(routeAt(analysis, plan.path.totalM).paceH, analysis.paceTotalH, 1e-9, `${label} fim da tabela`);

  // Rádio: os trechos cobrem a rota inteira sem buraco, e começa e termina com visada (habitat).
  const segments = analysis.radioSegments;
  assert.equal(segments[0].fromM, 0);
  near(segments.at(-1).toM, plan.path.totalM, 1e-6, `${label} rádio até o fim`);
  segments.forEach((segment, i) => i > 0 && assert.equal(segment.fromM, segments[i - 1].toM, `${label} rádio contíguo`));
  assert.ok(segments[0].visible && segments.at(-1).visible, `${label} visada no habitat`);
  if (field.isReal) assert.ok(segments.some((segment) => !segment.visible), `${label} há sombra de rádio no relevo real`);
  const start = radioAhead(analysis, 0);
  assert.ok(start.visible && start.changeInM > 0, `${label} sabe quando o rádio cai`);

  // Curvas: existem, em ordem, e a consulta devolve a próxima.
  assert.ok(analysis.maneuvers.length > 5 && analysis.maneuvers.length < 200, `${label} curvas: ${analysis.maneuvers.length}`);
  assert.ok(analysis.maneuvers.every((m, i, all) => i === 0 || m.distM > all[i - 1].distM), `${label} curvas em ordem`);
  assert.ok(nextManeuver(analysis, 0).distM >= 0);
  assert.ok(Math.abs(slopeAhead(analysis, 0, 60).deg) < 45);

  // Simulação nos trilhos: termina, e o relógio fecha com o ritmo simulado mais as coletas.
  let state = createNavState();
  for (let i = 0; i < 400000 && !state.finished; i++) state = advance(plan, analysis, state, 1 / 30, null);
  assert.ok(state.finished, `${label} chega ao fim`);
  near(elapsedH(analysis, state), analysis.paceTotalH + plan.stops.length * 0.75, 1e-6, `${label} relógio`);

  // Leitura e assistente em vários pontos: sempre há instrução e os números são finitos.
  for (const fraction of [0, 0.1, 0.35, 0.6, 0.9, 1]) {
    const at = jumpTo(plan, analysis, createNavState(), plan.path.totalM * fraction);
    const here = routeAt(analysis, at.distM);
    const pose = { x: here.x, z: here.z, headingDeg: 0, free: false, offM: 0, side: 'direita', movingKmh: 0 };
    const radioNow = lineOfSight(terrain.heightAt, { x: here.x, z: here.z, antennaM: ANTENNA_M.suit }, { x: analysis.xs[0], z: analysis.zs[0], antennaM: ANTENNA_M.habitat });
    const readout = deriveReadout({
      plan, analysis, state: at, pose, ground: terrain.probe(here.x, here.z),
      attitude: groundAttitude(terrain.heightAt, here.x, here.z, 0, 4), aheadFree: null, radioNow,
    });
    assert.ok([readout.elapsedH, readout.suit.o2Pct, readout.suit.marginH, readout.back.distM, readout.terrain.aheadDeg].every(Number.isFinite), `${label} leitura finita em ${fraction}`);
    const guidance = buildGuidance(plan, analysis, at, readout);
    assert.ok(guidance.primary.text.length > 10, `${label} instrução em ${fraction}`);
    assert.ok(guidance.advisories.length <= 3);
  }
}

// --- Caminhada livre: sair da rota de lado gera desvio e instrução de retomada. ---
{
  const plan = buildPlan('walk', false);
  const analysis = analyzePlan(plan, terrain);
  let state = setFree(plan, analysis, jumpTo(plan, analysis, createNavState(), 400), true);
  assert.ok(state.speed <= 20, 'caminhada livre limita a velocidade');
  const startHeading = state.free.headingDeg;
  state = patchState(state, { free: { ...state.free, headingDeg: (startHeading + 90) % 360 } });
  const before = elapsedH(analysis, state);
  for (let i = 0; i < 600; i++) state = advance(plan, analysis, state, 1 / 30, { move: 1, turn: 0, pitchDeg: 0 });
  assert.ok(state.free.offM > 100, `desvio lateral: ${state.free.offM}`);
  assert.equal(state.free.side, 'direita');
  near(elapsedH(analysis, state) - before, (20 * state.speed) / 3600, 1e-6, 'o relógio anda 20 s de simulação');
  const projected = projectOnRoute(analysis, state.free.x, state.free.z, 0, plan.path.totalM);
  assert.ok(projected.offM <= state.free.offM + 1e-6, 'projeção global não é pior que a da janela');

  // Saltar na barra recomeça do ritmo simulado: o tempo perdido fora da rota não vai junto.
  const idle = patchState(state, { extraH: 1.5 });
  assert.equal(jumpTo(plan, analysis, idle, 0).extraH, 0, 'salto zera o tempo extra');
  near(elapsedH(analysis, jumpTo(plan, analysis, idle, 0)), 0, 1e-9, 'relógio volta a zero no início');

  const pose = { ...state.free, free: true };
  const readout = deriveReadout({
    plan, analysis, state, pose, ground: terrain.probe(pose.x, pose.z),
    attitude: groundAttitude(terrain.heightAt, pose.x, pose.z, pose.headingDeg, 4),
    aheadFree: slopeAlongHeading(terrain.heightAt, pose.x, pose.z, pose.headingDeg, 60, 10),
    radioNow: { visible: true, clearanceM: 5, blockAtM: 0, distM: 500 },
  });
  assert.ok(readout.rejoin && readout.alerts.some((alert) => alert.kind === 'off-route'), 'alerta de fora da rota');
  assert.equal(buildGuidance(plan, analysis, state, readout).primary.kind, 'off-route');
  assert.equal(hazardStatus(0, 0, 0).inside, false);
}

// --- Plano com avaliação de segurança (plan.safety): rádio e ponto sem volta vêm de lá. ---
{
  const base = buildPlan('walk', false);
  const plan = { ...base, safety: { commsGaps: [{ fromM: 500, toM: 900 }, { fromM: 1200, toM: 1215 }], noReturn: { distM: 2000, walkH: 1 } } };
  const analysis = analyzePlan(plan, terrain);
  const blocked = analysis.radioSegments.filter((segment) => !segment.visible);
  assert.deepEqual(blocked.map((segment) => [segment.fromM, segment.toM]), [[500, 900], [1200, 1220]], 'trechos sem rádio iguais aos do plano');
  const readoutAt = (distM, walkBackH = null) => {
    const state = jumpTo(plan, analysis, createNavState(), distM);
    const here = routeAt(analysis, distM);
    const pose = { x: here.x, z: here.z, headingDeg: 0, free: false, offM: 0, side: 'direita', movingKmh: 0 };
    return {
      state,
      readout: deriveReadout({
        plan, analysis, state, pose, ground: terrain.probe(here.x, here.z),
        attitude: groundAttitude(terrain.heightAt, here.x, here.z, 0, 4), aheadFree: null,
        radioNow: { visible: true, clearanceM: 5, blockAtM: 0, distM: 500 }, walkBackH,
      }),
    };
  };
  // O trecho curto aparece na leitura, mas só o longo dispara o alerta antecipado.
  assert.equal(readoutAt(400).readout.radio.lossSoon, true, 'alerta antes do trecho longo sem rádio');
  assert.equal(readoutAt(1150).readout.radio.lossSoon, false, 'trecho de 20 m sem rádio não dispara alerta');
  assert.equal(readoutAt(1150).readout.radio.route.changeInM, 50, 'mas a leitura sabe que ele vem');
  // Um corte curto logo antes de um trecho longo não esconde o alerta do longo.
  const blip = analyzePlan({ ...base, safety: { commsGaps: [{ fromM: 300, toM: 315 }, { fromM: 360, toM: 900 }], noReturn: null } }, terrain);
  const radioAt250 = radioReading(blip, 250, { visible: true, clearanceM: 5, blockAtM: 0, distM: 250 }, 2.5);
  assert.equal(radioAt250.route.changeInM, 50, 'a próxima mudança é o corte curto');
  assert.deepEqual([radioAt250.lossSoon, radioAt250.lossInM], [true, 110], 'e o alerta aponta para o trecho longo');
  const before = readoutAt(1700);
  near(before.readout.noReturn.aheadM, 300, 1e-6, 'ponto sem volta à frente');
  assert.ok(buildGuidance(plan, analysis, before.state, before.readout).advisories.some((item) => item.kind === 'no-return'), 'aviso antes do ponto sem volta');
  const after = readoutAt(2500);
  assert.ok(after.readout.noReturn.passed && after.readout.alerts.some((alert) => alert.kind === 'no-return'), 'alerta depois do ponto sem volta');
  // Na volta para casa o ponto do plano já não vale: sem o roteador, o alerta some.
  assert.ok(!readoutAt(plan.path.totalM - 300).readout.stranded, 'ponto sem volta não persegue a volta');
  // Com o roteador, vale o oxigênio de agora contra a caminhada direta.
  assert.equal(readoutAt(2500, 0.5).readout.stranded, false, 'volta a pé de meia hora está coberta');
  assert.equal(readoutAt(2500, 9).readout.stranded, true, 'volta a pé de nove horas não está');
  assert.equal(readoutAt(2500, Infinity).readout.walkBack.noRoute, true, 'sem caminho a pé');
  assert.equal(readoutAt(100).readout.radio.route.changeInM, 400, 'o rádio cai onde o plano diz');
}

// --- Componentes fora do HUD: minimapa, perfil e guia só com o que recebem por parâmetro. ---
{
  // Canvas de mentira: aceita qualquer chamada de desenho e conta quantas foram feitas.
  let calls = 0;
  const context = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : (key === 'measureText' ? () => ({ width: 40 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => { calls += 1; })),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const fakeCanvas = () => ({ clientWidth: 200, clientHeight: 90, width: 0, height: 0, getContext: () => context });
  globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
  const { createMinimap, ZOOM_RADII_M } = await import('./minimapa.js');
  const { createProfile } = await import('./perfil.js');
  const { createWorldGuide } = await import('./mundo.js');

  for (const mode of ['walk', 'car']) {
    const plan = buildPlan(mode, true);
    const analysis = analyzePlan(plan, terrain);
    const minimap = createMinimap(fakeCanvas());
    const profile = createProfile(fakeCanvas());
    minimap.setPlan(plan, analysis);
    profile.setPlan(plan, analysis);
    // Câmera 2 m acima do chão, olhando para o norte (matriz de vista = só translação).
    const camera = { matrixWorldInverse: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, projectionMatrix: { elements: [1.2, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, -1, -1, 0, 0, -0.8, 0] } };
    const world = createWorldGuide({ canvas: fakeCanvas(), camera, heightAt: terrain.heightAt });
    for (const fraction of [0, 0.2, 0.5, 0.8, 1]) {
      const distM = plan.path.totalM * fraction;
      const here = routeAt(analysis, distM);
      camera.matrixWorldInverse.elements[12] = -here.x;
      camera.matrixWorldInverse.elements[13] = -(here.y + 2);
      camera.matrixWorldInverse.elements[14] = -here.z;
      for (const radiusM of ZOOM_RADII_M) {
        minimap.draw({ x: here.x, z: here.z, headingDeg: 40 + radiusM, lookDeg: 10, distM, radiusM, targetId: plan.stops[0].stop.id, rejoin: null, radio: { visible: fraction < 0.5, blockAtM: 120 } });
      }
      const summary = profile.draw(distM);
      assert.ok(Number.isFinite(summary.gainM) && Number.isFinite(summary.peakDeg), `${mode} resumo do perfil em ${fraction}`);
      world.draw({
        analysis, distM, limitM: plan.path.totalM, onFoot: here.onFoot, color: '#fff', timeS: fraction * 7,
        eye: { x: here.x, y: here.y + 2, z: here.z }, maneuver: nextManeuver(analysis, distM), feet: here,
        rejoin: { x: here.x + 30, z: here.z - 30 }, cssWidth: 800, cssHeight: 500,
      });
      // Sem o elemento de borda, apontar para um alvo não faz nada (e não quebra).
      world.pointTo({ x: here.x, y: here.y, z: here.z - 50, label: 'alvo' }, { left: 0, top: 0, width: 400, height: 300 });
    }
  }
  assert.ok(calls > 500, `os componentes desenharam (${calls} chamadas)`);
  delete globalThis.window;
}

// --- Destino livre (plan.isCustom): uma parada só, e o ritmo é o do próprio plano. ---
{
  const source = ROUTES.walk.legs[0];
  const points = source.coords.map(([lat, lon], i) => ({ ...toLocal(lat, lon), elev: source.profile[i] }));
  const [lat, lon] = source.coords.at(-1);
  registerStop({ id: 'D', name: 'Destino de teste', lat, lon, el: source.profile.at(-1) });
  const out = legFromPoints('H', 'D', points, source.max_slope, 0.5);
  const back = legFromPoints('D', 'H', [...points].reverse(), source.max_slope, 0.4);
  const plan = buildPlanFromLegs('walk', [out], back);
  const analysis = analyzePlan(plan, terrain);
  // A amostra de 10 m que cruza a troca de trecho usa a velocidade do trecho seguinte: sobra cerca de 1 s.
  near(analysis.paceTotalH, plan.path.totalTravelH, 2e-3, 'destino livre: ritmo igual ao do plano');
  let state = createNavState();
  for (let i = 0; i < 100000 && !state.finished; i++) state = advance(plan, analysis, state, 1 / 30, null);
  assert.ok(state.finished && state.stopsReached === 1, 'destino livre chega ao fim');
}

console.log('navegador: checagem ok', field.isReal ? '(relevo real)' : '(relevo aproximado)');
