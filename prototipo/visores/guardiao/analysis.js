// Análise de segurança: dá para voltar a pé? onde fica o ponto de não retorno?
// qual é o abrigo mais próximo e o oxigênio alcança? há rádio aqui?
//
// O tempo de volta a pé, a linha de visada do rádio e a proteção do relevo vêm do
// módulo compartilhado de segurança (context.safety, calculado sobre o DEM real), para
// o visor e o tablet darem a mesma resposta. O consumo de O₂, a reserva e a proteção
// de cada abrigo são hipóteses SIMULADAS.

import { SPEED_KMH, STOP_HOURS } from '../../data/travessia.js';
import { SIM } from '../../src/simulation.js';
import { samplePath } from '../../src/route.js';
import { RULES, FAULTS, PROTOCOLS, SHELTER_NAMES } from './catalog.js';
import { effects, mobility, o2PctOf, batteryPctOf, indexAt, isColdAt } from './engine.js';

const M_PER_KM = 1000;
const REFRESH_S = 0.25;

const walkHours = (distM) => distM / M_PER_KM / SPEED_KMH.walk;

// Projeta o plano daqui até o fim: O₂ em cada ponto e a folga para voltar a pé dali.
// É a mesma conta de `assessPlan` (src/safety.js), partindo do O₂ que resta agora.
function projectPlan(plan, state, fx, safety) {
  const { path } = plan;
  const here = samplePath(path, state.distM);
  const o2Now = o2PctOf(state);
  const walkRate = SIM.o2PctPerHour.foot + fx.leakPctH;
  const allFoot = plan.mode === 'walk' || fx.vehicleDown;

  let dwellH = state.dwellRemainingH;
  let stopIndex = state.stopsReached;
  let end = { spentH: 0, o2Pct: o2Now, batteryPct: batteryPctOf(state) };
  // Horas a pé em que o ar previsto está abaixo do mínimo do traje: é nelas que o aquecimento pesa.
  let coldFootH = 0;
  let lastFootH = 0;
  const samples = [];
  for (let i = indexAt(path, state.distM) + 1; i < path.points.length; i++) {
    const point = path.points[i];
    // A coleta de uma parada acontece antes de seguir adiante dela.
    while (plan.stops[stopIndex] && plan.stops[stopIndex].distM < point.distM) {
      dwellH += STOP_HOURS;
      stopIndex += 1;
    }
    const travelH = allFoot ? walkHours(point.distM - state.distM) : point.travelH - here.travelH;
    const footH = (allFoot ? travelH : point.footH - here.footH) + dwellH;
    const cabinH = travelH + dwellH - footH;
    const spentH = travelH + dwellH;
    if (isColdAt(plan, fx, state.clockH + spentH)) coldFootH += footH - lastFootH;
    lastFootH = footH;
    end = {
      spentH,
      o2Pct: o2Now - SIM.o2PctPerHour.foot * footH - SIM.o2PctPerHour.cabin * cabinH - fx.leakPctH * spentH,
      batteryPct: batteryPctOf(state) - SIM.batteryPctPerHour.foot * footH - FAULTS.coldBatteryExtraPctH * coldFootH - SIM.batteryPctPerHour.cabin * cabinH,
    };
    // Sem caminho a pé conhecido (Infinity), a folga fica negativa: conta como ponto sem volta.
    samples.push({ distM: point.distM, spentH, marginPct: end.o2Pct - walkRate * safety.walkBackAt(point.x, point.z) - RULES.o2ReservePct });
  }
  return { samples, end };
}

const zoneOf = (marginPct) => (marginPct < 0 ? 'nao' : marginPct < RULES.o2TightPct ? 'justa' : 'ok');

// Trechos da rota à frente por situação de volta a pé, para a faixa do HUD.
function buildZones(samples, marginNowPct, totalM) {
  const zones = [{ status: zoneOf(marginNowPct), to: 1 }];
  for (const sample of samples) {
    const status = zoneOf(sample.marginPct);
    const current = zones[zones.length - 1];
    if (status === current.status) continue;
    current.to = sample.distM / totalM;
    zones.push({ status, to: 1 });
  }
  return zones;
}

function findPnr(plan, samples, marginNowPct, distM) {
  if (marginNowPct < 0) return { status: 'passed', distM, aheadM: 0, etaH: 0, position: samplePath(plan.path, distM) };
  const first = samples.find((sample) => sample.marginPct < 0);
  if (!first) return { status: 'none', distM: null, aheadM: Infinity, etaH: Infinity, position: null };
  return { status: 'ahead', distM: first.distM, aheadM: first.distM - distM, etaH: first.spentH, position: samplePath(plan.path, first.distM) };
}

// Volta a pé ao habitat pelo caminho mais rápido no relevo (tempo de `safety.walkBackAt`).
function walkHome(plan, state, fx, pos, safety) {
  const timeH = safety.walkBackAt(pos.x, pos.z);
  const o2NeedPct = timeH * (SIM.o2PctPerHour.foot + fx.leakPctH);
  const o2AfterPct = o2PctOf(state) - o2NeedPct;
  // O visor só conhece a linha da rota: a volta é mostrada por ela, no sentido mais curto.
  const dir = state.distM <= plan.path.totalM - state.distM ? 'back' : 'fwd';
  return { timeH, o2NeedPct, o2AfterPct, dir, ok: o2AfterPct >= RULES.o2ReservePct, reaches: o2AfterPct > 0 };
}

const DIR_TEXT = Object.freeze({ back: 'por trás', fwd: 'em frente' });

function withReach(option, o2Now) {
  const o2AfterPct = o2Now - option.o2NeedPct;
  return { ...option, name: SHELTER_NAMES[option.kind], o2AfterPct, reaches: o2AfterPct > 0, usesReserve: o2AfterPct < RULES.o2ReservePct };
}

function habitatOption(plan, state, m, fx, ret, offM) {
  const { path } = plan;
  if (m.vehicleM === null || fx.vehicleDown) {
    const targetM = ret.dir === 'back' ? 0 : path.totalM;
    const routeM = Math.abs(targetM - state.distM) + offM;
    // O tempo é o do caminho a pé mais rápido; o ritmo ao longo da linha da rota é ajustado para fechar com ele.
    const paceKmh = ret.timeH > 0 && Number.isFinite(ret.timeH) ? routeM / M_PER_KM / ret.timeH : SPEED_KMH.walk;
    return {
      kind: 'habitat', distM: null, timeH: ret.timeH, o2NeedPct: ret.o2NeedPct, dirText: 'a pé',
      exposure: FAULTS.exposure.habitat, target: { kind: 'habitat', distM: targetM, paceKmh }, position: samplePath(path, targetM),
    };
  }
  // Com veículo, o tempo segue as velocidades do plano: cabine onde dá, a pé no trecho bloqueado.
  const legs = [
    { dir: 'back', travelH: m.here.travelH, footH: m.here.footH },
    { dir: 'fwd', travelH: path.totalTravelH - m.here.travelH, footH: path.totalFootH - m.here.footH },
  ].map((leg) => ({
    dir: leg.dir,
    timeH: leg.travelH + walkHours(offM),
    o2NeedPct: SIM.o2PctPerHour.foot * (leg.footH + walkHours(offM)) + SIM.o2PctPerHour.cabin * (leg.travelH - leg.footH) + fx.leakPctH * leg.travelH,
  }));
  const best = legs[0].timeH <= legs[1].timeH ? legs[0] : legs[1];
  const targetM = best.dir === 'back' ? 0 : path.totalM;
  return {
    kind: 'habitat', distM: Math.abs(targetM - state.distM) + offM, timeH: best.timeH, o2NeedPct: best.o2NeedPct, dirText: DIR_TEXT[best.dir],
    exposure: FAULTS.exposure.habitat, target: { kind: 'habitat', distM: targetM }, position: samplePath(path, targetM),
  };
}

function vehicleOption(plan, state, m, fx, offM) {
  if (m.vehicleM === null) return null;
  const distM = m.inCabin ? 0 : Math.abs(state.distM - m.vehicleM) + offM;
  let dirText = 'você está nele';
  if (distM > 0) dirText = m.vehicleM <= state.distM ? DIR_TEXT.back : DIR_TEXT.fwd;
  return {
    kind: 'vehicle', distM, timeH: walkHours(distM), o2NeedPct: walkHours(distM) * (SIM.o2PctPerHour.foot + fx.leakPctH), dirText,
    down: fx.vehicleDown, exposure: FAULTS.exposure.vehicle, target: { kind: 'vehicle', distM: m.vehicleM }, position: samplePath(plan.path, m.vehicleM),
  };
}

// Proteção do relevo: o ponto encaixado mais próximo, segundo `safety.nearestShelter`.
// ponytail: ida em linha reta, sem desvio de obstáculo; pedir ao módulo compartilhado o caminho até o abrigo.
function terrainOption(state, pos, fx, spot) {
  if (state.sheltered === 'terrain') {
    return { kind: 'terrain', distM: 0, timeH: 0, o2NeedPct: 0, dirText: 'você está nele', exposure: state.exposure, skyBlocked: 1 - state.exposure, target: null, position: pos };
  }
  if (!spot) return null;
  return {
    kind: 'terrain', distM: spot.distM, timeH: spot.walkH, o2NeedPct: spot.walkH * (SIM.o2PctPerHour.foot + fx.leakPctH), dirText: 'fora da rota',
    exposure: 1 - spot.skyBlocked, skyBlocked: spot.skyBlocked,
    target: { kind: 'terrain', x: spot.x, z: spot.z, skyBlocked: spot.skyBlocked }, position: spot,
  };
}

/**
 * Escolhe o abrigo para uma política de protocolo. Dentro do prazo vale a melhor
 * proteção; fora do prazo, o mais próximo que o O₂ alcança, marcado como provisório.
 */
export function pickShelter(options, policy, fx) {
  const usable = options.filter((option) => policy.kinds.includes(option.kind) && option.reaches);
  if (usable.length === 0) return null;
  const nearest = usable.reduce((a, b) => (b.timeH < a.timeH ? b : a));
  if (policy.nearest) return nearest;
  const budgetH = policy.budgetH ? policy.budgetH(fx) : Infinity;
  const inBudget = usable.filter((option) => option.timeH <= budgetH);
  if (inBudget.length === 0) return { ...nearest, provisional: true };
  return inBudget.reduce((a, b) => (policy.kinds.indexOf(b.kind) < policy.kinds.indexOf(a.kind) ? b : a));
}

// Rádio direto com o habitat: há visada agora? e onde começa ou termina o trecho sem ela?
function commsStatus(plan, state, pos, safety) {
  const visible = safety.commsAt(pos.x, pos.z).visible;
  const gaps = plan.safety?.commsGaps ?? [];
  const current = gaps.find((gap) => state.distM >= gap.fromM && state.distM < gap.toM);
  const next = gaps.find((gap) => gap.fromM > state.distM);
  return {
    visible,
    gapLeftM: current ? current.toM - state.distM : 0,
    nextGap: next ? { aheadM: next.fromM - state.distM, lengthM: next.toM - next.fromM } : null,
  };
}

/**
 * Tudo o que responde "estou seguro, e se não estiver, para onde vou?".
 * @param {{ x: number, z: number }} pos Posição atual (na rota ou fora dela).
 * @param {{ walkBackAt: Function, commsAt: Function, nearestShelter: Function }} safety `context.safety`.
 * @param {boolean} realRelief O relevo como abrigo só é oferecido sobre o DEM real.
 */
export function analyze(plan, state, pos, safety, realRelief) {
  const fx = effects(state);
  const m = mobility(plan, state);
  const offM = state.off ? Math.hypot(pos.x - m.here.x, pos.z - m.here.z) : 0;
  const ret = walkHome(plan, state, fx, pos, safety);
  const { samples, end } = projectPlan(plan, state, fx, safety);
  const marginNowPct = ret.o2AfterPct - RULES.o2ReservePct;
  const o2Now = o2PctOf(state);
  const spot = realRelief ? safety.nearestShelter(pos.x, pos.z).terrain : null;
  const shelters = [habitatOption(plan, state, m, fx, ret, offM), vehicleOption(plan, state, m, fx, offM), terrainOption(state, pos, fx, spot)]
    .filter(Boolean)
    .map((option) => withReach(option, o2Now));
  return {
    ret,
    pnr: findPnr(plan, samples, marginNowPct, state.distM),
    zones: buildZones(samples, marginNowPct, plan.path.totalM),
    o2EndPct: end.o2Pct,
    batteryEndPct: end.batteryPct,
    planRemainingH: end.spentH,
    shelters,
    picks: Object.fromEntries(Object.entries(PROTOCOLS).map(([id, protocol]) => [id, pickShelter(shelters, protocol.shelter, fx)])),
    nearest: pickShelter(shelters, { kinds: ['habitat', 'vehicle'], nearest: true }, fx),
    comms: commsStatus(plan, state, pos, safety),
  };
}

/** Analisador com cache: a conta roda poucas vezes por segundo, não a cada quadro. */
export function createAnalyzer(safety, realRelief) {
  let cached = null;
  let ageS = Infinity;
  return {
    invalidate() { ageS = Infinity; },
    get(plan, state, pos, dtS) {
      ageS += dtS;
      if (cached && ageS < REFRESH_S) return cached;
      ageS = 0;
      cached = analyze(plan, state, pos, safety, realRelief);
      return cached;
    },
  };
}
