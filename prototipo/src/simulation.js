// Simulação da saída para o modo visor. Tudo aqui é função pura: recebe o plano
// e o estado e devolve o próximo estado ou a leitura para o HUD.
//
// A telemetria do traje, a radiação e as mensagens do copiloto são SIMULADAS
// por regras simples. Posição, distância e declive vêm das rotas reais.

import { HAZARD, STOP_HOURS } from '../data/travessia.js';
import { toLocal, headingDeg, angleDeltaDeg, clamp } from './geo.js';
import { samplePath, headingAt, slopeDegAt, maxSlopeAheadDeg, shortName, findStop } from './route.js';
import { fmtDistance, fmtDuration, fmtNumber } from './format.js';

export const SIM = Object.freeze({
  speeds: [1, 20, 60, 200],
  defaultSpeed: 60,
  dwellSpeed: 900,
  startClockH: 9,
  o2PctPerHour: Object.freeze({ foot: 12.5, cabin: 4 }),
  batteryPctPerHour: Object.freeze({ foot: 9, cabin: 5 }),
  radiationBaseUsvH: 27,
  solarEventFactor: 40,
  hazardWarnM: 200,
  slopeWarnDeg: 15,
  slopeLookaheadM: 60,
  slopeStepM: 10,
  lowMarginH: 1,
});

const SECONDS_PER_HOUR = 3600;
const AHEAD_CONE_DEG = 30;
const BEHIND_CONE_DEG = 150;
const AT_TARGET_M = 1;

export const createSimState = () => Object.freeze({
  distM: 0,
  stopsReached: 0,
  dwellRemainingH: 0,
  paused: false,
  finished: false,
  speed: SIM.defaultSpeed,
  solarEvent: false,
  solarDoseUsv: 0,
});

export const patchState = (state, changes) => Object.freeze({ ...state, ...changes });

// Horas de missão: deslocamento até aqui mais o tempo já gasto nas paradas.
export function missionHours(plan, state) {
  return samplePath(plan.path, state.distM).travelH + state.stopsReached * STOP_HOURS - state.dwellRemainingH;
}

function advanceDwell(state, dtRealS) {
  const dtH = (dtRealS * Math.max(state.speed, SIM.dwellSpeed)) / SECONDS_PER_HOUR;
  return patchState(state, { dwellRemainingH: Math.max(0, state.dwellRemainingH - dtH) });
}

function advanceTravel(plan, state, dtRealS) {
  const here = samplePath(plan.path, state.distM);
  const targetM = state.distM + (here.speedKmh / 3.6) * dtRealS * state.speed;
  const nextStop = plan.stops[state.stopsReached];
  if (nextStop && targetM >= nextStop.distM) {
    return patchState(state, { distM: nextStop.distM, stopsReached: state.stopsReached + 1, dwellRemainingH: STOP_HOURS });
  }
  if (targetM >= plan.path.totalM) return patchState(state, { distM: plan.path.totalM, finished: true });
  return patchState(state, { distM: targetM });
}

/** Avança a simulação em `dtRealS` segundos de relógio. */
export function advance(plan, state, dtRealS) {
  if (state.paused || state.finished) return state;
  const beforeH = missionHours(plan, state);
  const next = state.dwellRemainingH > 0 ? advanceDwell(state, dtRealS) : advanceTravel(plan, state, dtRealS);
  if (!next.solarEvent) return next;
  const extraRate = SIM.radiationBaseUsvH * (SIM.solarEventFactor - 1);
  return patchState(next, { solarDoseUsv: next.solarDoseUsv + extraRate * (missionHours(plan, next) - beforeH) });
}

/** Salta para um ponto da rota (barra de progresso). */
export function jumpTo(plan, state, distM) {
  const target = clamp(distM, 0, plan.path.totalM);
  return patchState(state, {
    distM: target,
    // Parada exatamente no ponto do salto ainda não conta: a coleta começa no próximo quadro.
    stopsReached: plan.stops.filter((entry) => entry.distM < target).length,
    dwellRemainingH: 0,
    finished: target >= plan.path.totalM,
  });
}

function nextTarget(plan, state, here) {
  if (state.dwellRemainingH > 0) {
    const { stop } = plan.stops[state.stopsReached - 1];
    return { kind: 'dwell', stop, label: `Em coleta · parada ${stop.id}`, name: shortName(stop.id), distM: 0, etaH: state.dwellRemainingH, gainM: 0, position: toLocal(stop.lat, stop.lon) };
  }
  const next = plan.stops[state.stopsReached];
  if (next) {
    const at = samplePath(plan.path, next.distM);
    return {
      kind: 'stop', stop: next.stop, label: `Próxima parada · ${next.stop.id}`, name: shortName(next.stop.id),
      distM: next.distM - here.distM, etaH: at.travelH - here.travelH, gainM: next.stop.el - here.elev, position: at,
    };
  }
  const end = samplePath(plan.path, plan.path.totalM);
  return {
    kind: 'return', stop: findStop('H'), label: 'Retorno', name: 'Habitat',
    distM: plan.path.totalM - here.distM, etaH: plan.path.totalTravelH - here.travelH, gainM: end.elev - here.elev, position: end,
  };
}

// Consumo do traje: fora da cabine gasta mais. Margem = o que sobra depois de terminar o plano.
function suitStatus(plan, state, here) {
  const dwellDoneH = state.stopsReached * STOP_HOURS - state.dwellRemainingH;
  const footH = here.footH + dwellDoneH;
  const cabinH = here.travelH - here.footH;
  const usedPct = (rates) => rates.foot * footH + rates.cabin * cabinH;
  const o2Pct = clamp(100 - usedPct(SIM.o2PctPerHour), 0, 100);

  const dwellLeftH = (plan.stops.length - state.stopsReached) * STOP_HOURS + state.dwellRemainingH;
  const footLeftH = plan.path.totalFootH - here.footH + dwellLeftH;
  const cabinLeftH = plan.path.totalTravelH - plan.path.totalFootH - cabinH;
  const o2NeededPct = SIM.o2PctPerHour.foot * footLeftH + SIM.o2PctPerHour.cabin * cabinLeftH;

  return {
    o2Pct,
    batteryPct: clamp(100 - usedPct(SIM.batteryPctPerHour), 0, 100),
    marginH: (o2Pct - o2NeededPct) / SIM.o2PctPerHour.foot,
    hoursToFinish: footLeftH + cabinLeftH,
  };
}

// Rumo até o alvo, ou null quando já se está em cima dele (não há direção a apontar).
function bearingTo(here, position) {
  const dx = position.x - here.x;
  const dz = position.z - here.z;
  return Math.hypot(dx, dz) < AT_TARGET_M ? null : headingDeg(dx, dz);
}

function hazardStatus(here, heading) {
  const center = toLocal(HAZARD.lat, HAZARD.lon);
  const edgeM = Math.hypot(center.x - here.x, center.z - here.z) - HAZARD.radiusKm * 1000;
  const relative = angleDeltaDeg(heading, headingDeg(center.x - here.x, center.z - here.z));
  let side = relative > 0 ? 'à direita' : 'à esquerda';
  if (Math.abs(relative) < AHEAD_CONE_DEG) side = 'à frente';
  if (Math.abs(relative) > BEHIND_CONE_DEG) side = 'atrás';
  return { edgeM, side, near: edgeM < SIM.hazardWarnM };
}

// Temperatura do ar simulada: curva diurna mais um pouco do aquecimento do solo.
function airTemperature(clockH, groundTemp) {
  const daylight = Math.max(0, Math.sin((Math.PI * (clockH - 6)) / 13));
  return -52 + 34 * daylight + (groundTemp + 19) * 0.25;
}

function buildAlerts(state, readout) {
  const alerts = [];
  const { suit, hazard, slopeAheadDeg } = readout;
  if (state.solarEvent) alerts.push({ kind: 'solar', level: 'danger', text: `Evento solar · dose ${SIM.solarEventFactor}× acima do normal` });
  if (suit.marginH < 0) alerts.push({ kind: 'o2-short', level: 'danger', text: `O₂ insuficiente para o plano · faltam ${fmtDuration(-suit.marginH)}` });
  else if (suit.marginH < SIM.lowMarginH) alerts.push({ kind: 'o2-low', level: 'warn', text: `Margem de O₂ baixa · ${fmtDuration(suit.marginH)}` });
  if (hazard.near) alerts.push({ kind: 'hazard', level: 'warn', text: `Rochas cortantes a ${fmtDistance(Math.max(0, hazard.edgeM))} ${hazard.side}` });
  if (slopeAheadDeg >= SIM.slopeWarnDeg) alerts.push({ kind: 'slope', level: 'warn', text: `Declive de ${fmtNumber(slopeAheadDeg)}° à frente` });
  return alerts;
}

// Uma frase por vez, escolhida pela regra de maior prioridade que se aplica.
function copilotMessage(plan, state, readout) {
  const { here, suit, target, hazard, slopeAheadDeg } = readout;
  if (state.finished) return 'Travessia concluída. Você está de volta ao habitat.';
  if (state.solarEvent) {
    const backM = Math.min(here.distM, plan.path.totalM - here.distM);
    return `Evento solar em curso. Volte ao habitat pelo caminho mais curto: ${fmtDistance(backM)}, cerca de ${fmtDuration(backM / 1000 / here.speedKmh)}.`;
  }
  if (suit.marginH < 0) {
    const fix = plan.mode === 'walk' ? 'Encurte a rota ou troque para o veículo.' : 'Encurte a rota.';
    return `O oxigênio não cobre este plano: faltam ${fmtDuration(-suit.marginH)} de autonomia. ${fix}`;
  }
  if (target.kind === 'dwell') return `Parada ${target.stop.id}, ${target.name}. Tarefa: ${target.stop.task}`;
  if (hazard.near) return `Rochas cortantes a ${fmtDistance(Math.max(0, hazard.edgeM))} ${hazard.side}. Mantenha-se na rota marcada.`;
  if (slopeAheadDeg >= SIM.slopeWarnDeg) {
    return `Declive de ${fmtNumber(slopeAheadDeg)}° nos próximos ${SIM.slopeLookaheadM} m. Reduza o passo e firme o apoio.`;
  }
  if (target.kind === 'return') return `Coletas concluídas. Siga ${fmtDistance(target.distM)} de volta ao habitat, chegada em ${fmtDuration(target.etaH)}.`;
  return `Siga ${fmtDistance(target.distM)} até ${target.name}. Chegada em ${fmtDuration(target.etaH)}.`;
}

/**
 * Tudo o que o HUD mostra em um instante.
 * @param {object} plan
 * @param {ReturnType<typeof createSimState>} state
 * @param {{ radiation: number, groundTemp: number }} ground Leitura do terreno no ponto atual.
 */
export function deriveReadout(plan, state, ground) {
  const here = samplePath(plan.path, state.distM);
  const elapsedH = missionHours(plan, state);
  const heading = headingAt(plan.path, state.distM);
  const target = nextTarget(plan, state, here);
  const clockH = SIM.startClockH + elapsedH;
  const readout = {
    here,
    elapsedH,
    clockH,
    heading,
    target,
    targetBearing: bearingTo(here, target.position),
    suit: suitStatus(plan, state, here),
    hazard: hazardStatus(here, heading),
    slopeDeg: slopeDegAt(plan.path, state.distM),
    slopeAheadDeg: maxSlopeAheadDeg(plan.path, state.distM, SIM.slopeLookaheadM, SIM.slopeStepM),
    radiationRate: ground.radiation * (state.solarEvent ? SIM.solarEventFactor : 1),
    doseUsv: SIM.radiationBaseUsvH * elapsedH + state.solarDoseUsv,
    airTempC: airTemperature(clockH, ground.groundTemp),
  };
  return { ...readout, alerts: buildAlerts(state, readout), copilot: copilotMessage(plan, state, readout) };
}
