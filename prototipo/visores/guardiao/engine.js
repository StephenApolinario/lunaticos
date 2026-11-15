// Motor do Guardião: estado da saída integrado no tempo. O visor base deriva tudo da
// posição na rota; aqui isso não serve, porque numa emergência o astronauta para,
// volta pelo caminho ou sai da rota para se abrigar. Funções puras.
//
// Posição, distância e relevo vêm das rotas e do DEM reais. Telemetria do traje,
// radiação, clima e panes são SIMULADOS.

import { SPEED_KMH, STOP_HOURS } from '../../data/travessia.js';
import { SIM } from '../../src/simulation.js';
import { samplePath } from '../../src/route.js';
import { clamp } from '../../src/geo.js';
import { FAULTS } from './catalog.js';

const SECONDS_PER_HOUR = 3600;
const M_PER_KM = 1000;
const AT_VEHICLE_M = 1;

export const NAV_PLAN = Object.freeze({ kind: 'plan' });
export const NAV_HOLD = Object.freeze({ kind: 'hold' });

export const createState = () => Object.freeze({
  distM: 0,
  stopsReached: 0,
  dwellRemainingH: 0,
  paused: false,
  finished: false,
  speed: SIM.defaultSpeed,
  clockH: 0,
  o2UsedPct: 0,
  o2LostPct: 0, // perdas súbitas (falha de tanque), fora do consumo
  batteryUsedPct: 0,
  doseUsv: 0,
  integrityPct: 100,
  patched: false,
  nav: NAV_PLAN, // plan: segue o plano · hold: parado · goto: indo a um abrigo
  off: null, // posição { x, z } quando fora da rota
  sheltered: null, // 'habitat' | 'vehicle' | 'terrain'
  exposure: 1, // fração da radiação extra que chega no abrigo atual
  scenarios: Object.freeze({}),
});

export const patch = (state, changes) => Object.freeze({ ...state, ...changes });
export const o2PctOf = (state) => clamp(100 - state.o2UsedPct - state.o2LostPct, 0, 100);
export const batteryPctOf = (state) => clamp(100 - state.batteryUsedPct, 0, 100);

/** Índice do último ponto do caminho em ou antes de `distM`. */
export function indexAt(path, distM) {
  let lo = 0;
  let hi = path.points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.points[mid].distM <= distM) lo = mid;
    else hi = mid;
  }
  return lo;
}

const stopsUpTo = (plan, distM) => plan.stops.filter((entry) => entry.distM <= distM).length;

/** Efeito dos cenários ativos sobre o mundo simulado. */
export function effects(state) {
  const sc = state.scenarios;
  const dustEtaH = sc.poeira ? Math.max(0, FAULTS.dustEtaH - sc.poeira.ageH) : null;
  const dust = sc.poeira ? { etaH: dustEtaH, arrived: dustEtaH === 0 } : null;
  let radio = { state: 'ok', lostH: 0 };
  if (dust?.arrived) radio = { state: 'noise', lostH: 0 };
  if (sc.radio) radio = { state: 'lost', lostH: sc.radio.ageH };
  return {
    radFactor: sc.solar ? FAULTS.solarFactor : 1,
    dust,
    tempOffsetC: sc.frio ? FAULTS.coldOffsetC : 0,
    windMps: sc.vento ? FAULTS.windStormMps : FAULTS.windNominalMps,
    radio,
    vehicleDown: Boolean(sc.veiculo),
    leakPctH: (100 - state.integrityPct) * FAULTS.leakPctHPerPoint,
  };
}

/** Onde o veículo está ao longo da rota, ou null no plano a pé. */
export function vehicleDistM(plan, state) {
  if (plan.mode !== 'car') return null;
  if (state.scenarios.veiculo) return state.scenarios.veiculo.atDistM;
  if (!samplePath(plan.path, state.distM).onFoot) return state.distM;
  // Em trecho bloqueado o veículo ficou no último ponto em que dava para dirigir.
  const { points } = plan.path;
  for (let i = indexAt(plan.path, state.distM); i >= 0; i--) {
    if (!points[i].onFoot) return points[i].distM;
  }
  return 0;
}

/** Como o astronauta se desloca agora: na cabine ou a pé, e a que velocidade. */
export function mobility(plan, state) {
  const here = samplePath(plan.path, state.distM);
  const vehicleM = vehicleDistM(plan, state);
  const vehicleDown = Boolean(state.scenarios.veiculo);
  const atVehicle = vehicleM !== null && !state.off && Math.abs(vehicleM - state.distM) < AT_VEHICLE_M;
  const inCabin = state.sheltered === 'vehicle' || (atVehicle && state.dwellRemainingH === 0);
  const driving = inCabin && !vehicleDown && !here.onFoot;
  return { here, vehicleM, vehicleDown, inCabin, driving, speedKmh: driving ? here.speedKmh : SPEED_KMH.walk };
}

/** Consumo e dose por hora neste instante. `ground` é a leitura do terreno aqui. */
export function ratesOf(plan, state, ground) {
  const fx = effects(state);
  const m = mobility(plan, state);
  const where = m.inCabin ? 'cabin' : 'foot';
  const inHabitat = state.sheltered === 'habitat';
  let exposure = 1;
  if (m.inCabin) exposure = FAULTS.exposure.vehicle;
  if (state.sheltered) exposure = state.exposure;
  const cold = fx.tempOffsetC < 0 && !m.inCabin ? FAULTS.coldBatteryExtraPctH : 0;
  return {
    o2PctH: inHabitat ? 0 : SIM.o2PctPerHour[where] + fx.leakPctH,
    batteryPctH: inHabitat ? 0 : SIM.batteryPctPerHour[where] + cold,
    doseUsvH: ground.radiation * (1 + (fx.radFactor - 1) * exposure),
  };
}

export function positionOf(plan, state) {
  const here = samplePath(plan.path, state.distM);
  return state.off ? { ...here, x: state.off.x, z: state.off.z } : here;
}

function arrive(state, kind, exposure, changes) {
  return patch(state, { ...changes, sheltered: kind, exposure, finished: kind === 'habitat', nav: NAV_HOLD, dwellRemainingH: 0 });
}

// Fora da rota o deslocamento é a pé e em linha reta.
// ponytail: sem desvio de obstáculo fora da rota; trocar por busca de caminho no DEM se o abrigo no relevo virar entrega.
function moveStraight(state, goal, dtH) {
  const stepM = SPEED_KMH.walk * M_PER_KM * dtH;
  const dx = goal.x - state.off.x;
  const dz = goal.z - state.off.z;
  const gapM = Math.hypot(dx, dz);
  if (stepM < gapM) {
    const t = stepM / gapM;
    return patch(state, { off: Object.freeze({ x: state.off.x + dx * t, z: state.off.z + dz * t }) });
  }
  if (goal.kind === 'terrain') return arrive(state, 'terrain', 1 - goal.skyBlocked, { off: Object.freeze({ x: goal.x, z: goal.z }) });
  return patch(state, { off: null });
}

function moveGoto(plan, state, m, dtH) {
  const { target } = state.nav;
  if (target.kind === 'terrain') {
    const start = state.off ? state : patch(state, { off: Object.freeze({ x: m.here.x, z: m.here.z }), dwellRemainingH: 0 });
    return moveStraight(start, target, dtH);
  }
  const gapM = target.distM - state.distM;
  // A pé rumo ao habitat, o ritmo vem do tempo de volta calculado no relevo (ver analysis.js).
  const speedKmh = m.driving ? m.speedKmh : target.paceKmh ?? SPEED_KMH.walk;
  const stepM = speedKmh * M_PER_KM * dtH;
  if (stepM >= Math.abs(gapM)) {
    const exposure = FAULTS.exposure[target.kind];
    return arrive(state, target.kind, exposure, { distM: target.distM, stopsReached: Math.max(state.stopsReached, stopsUpTo(plan, target.distM)) });
  }
  const distM = state.distM + Math.sign(gapM) * stepM;
  // Indo ao abrigo não há coleta: as paradas no caminho só são contadas como passadas.
  return patch(state, { distM, dwellRemainingH: 0, stopsReached: Math.max(state.stopsReached, stopsUpTo(plan, distM)) });
}

function movePlan(plan, state, m, dtH) {
  if (state.dwellRemainingH > 0) return patch(state, { dwellRemainingH: Math.max(0, state.dwellRemainingH - dtH) });
  const targetM = state.distM + m.speedKmh * M_PER_KM * dtH;
  const nextStop = plan.stops[state.stopsReached];
  if (nextStop && targetM >= nextStop.distM) {
    return patch(state, { distM: nextStop.distM, stopsReached: state.stopsReached + 1, dwellRemainingH: STOP_HOURS });
  }
  if (targetM >= plan.path.totalM) return arrive(state, 'habitat', FAULTS.exposure.habitat, { distM: plan.path.totalM });
  return patch(state, { distM: targetM });
}

function move(plan, state, dtH) {
  if (state.nav.kind === 'hold') return state;
  const m = mobility(plan, state);
  const toTerrain = state.nav.kind === 'goto' && state.nav.target.kind === 'terrain';
  // Quem saiu da rota volta ao ponto de onde saiu antes de qualquer outra coisa.
  if (state.off && !toTerrain) return moveStraight(state, samplePath(plan.path, state.distM), dtH);
  return state.nav.kind === 'goto' ? moveGoto(plan, state, m, dtH) : movePlan(plan, state, m, dtH);
}

/**
 * Avança a simulação em `dtRealS` segundos de relógio.
 * @param {{ o2PctH: number, batteryPctH: number, doseUsvH: number }} rates Consumo atual (de `ratesOf`).
 */
export function advance(plan, state, dtRealS, rates) {
  if (state.paused || state.finished) return state;
  const dwelling = state.nav.kind === 'plan' && !state.off && state.dwellRemainingH > 0;
  const simSpeed = dwelling ? Math.max(state.speed, SIM.dwellSpeed) : state.speed;
  const rawH = (dtRealS * simSpeed) / SECONDS_PER_HOUR;
  const dtH = dwelling ? Math.min(rawH, state.dwellRemainingH) : rawH;
  const moved = move(plan, state, dtH);
  const scenarios = Object.fromEntries(Object.entries(moved.scenarios).map(([id, sc]) => [id, { ...sc, ageH: sc.ageH + dtH }]));
  return patch(moved, {
    clockH: moved.clockH + dtH,
    o2UsedPct: Math.min(100, moved.o2UsedPct + rates.o2PctH * dtH),
    batteryUsedPct: Math.min(100, moved.batteryUsedPct + rates.batteryPctH * dtH),
    doseUsv: moved.doseUsv + rates.doseUsvH * dtH,
    scenarios: Object.freeze(scenarios),
  });
}

/** Salta para um ponto da rota (barra de posição): refaz o consumo nominal do plano até ali. */
export function jump(plan, state, distM) {
  const target = clamp(distM, 0, plan.path.totalM);
  const here = samplePath(plan.path, target);
  const stopsReached = plan.stops.filter((entry) => entry.distM < target).length;
  const footH = here.footH + stopsReached * STOP_HOURS;
  const cabinH = here.travelH - here.footH;
  const clockH = here.travelH + stopsReached * STOP_HOURS;
  const finished = target >= plan.path.totalM;
  return patch(state, {
    distM: target,
    stopsReached,
    dwellRemainingH: 0,
    finished,
    clockH,
    o2UsedPct: SIM.o2PctPerHour.foot * footH + SIM.o2PctPerHour.cabin * cabinH,
    batteryUsedPct: SIM.batteryPctPerHour.foot * footH + SIM.batteryPctPerHour.cabin * cabinH,
    doseUsv: SIM.radiationBaseUsvH * clockH,
    off: null,
    sheltered: finished ? 'habitat' : null,
    exposure: finished ? FAULTS.exposure.habitat : 1,
    nav: finished ? NAV_HOLD : NAV_PLAN,
  });
}

/** Liga um cenário de demonstração. */
export function triggerScenario(plan, state, id) {
  if (state.scenarios[id]) return state;
  if (id === 'veiculo' && plan.mode !== 'car') return state;
  const entry = id === 'veiculo' ? { ageH: 0, atDistM: vehicleDistM(plan, state) } : { ageH: 0 };
  let changes = {};
  if (id === 'o2') changes = { o2LostPct: state.o2LostPct + Math.max(0, o2PctOf(state) - FAULTS.o2FaultPct) };
  if (id === 'traje') changes = { integrityPct: FAULTS.fallIntegrityPct, patched: false };
  return patch(state, { ...changes, scenarios: Object.freeze({ ...state.scenarios, [id]: entry }) });
}

/** Desliga um cenário e desfaz a pane que ele injetou. */
export function clearScenario(state, id) {
  const { [id]: removed, ...rest } = state.scenarios;
  if (!removed) return state;
  let changes = {};
  if (id === 'o2') changes = { o2LostPct: 0 };
  if (id === 'traje') changes = { integrityPct: 100, patched: false };
  return patch(state, { ...changes, scenarios: Object.freeze(rest) });
}

/** Selante de emergência: reduz o vazamento, não zera. */
export function applyPatch(state) {
  if (state.integrityPct >= FAULTS.patchIntegrityPct) return state;
  return patch(state, { integrityPct: FAULTS.patchIntegrityPct, patched: true });
}

/** Sai do abrigo (ou da parada de emergência) e retoma o plano. */
export function release(state) {
  if (state.finished) return state;
  return patch(state, { nav: NAV_PLAN, sheltered: null, exposure: 1 });
}
