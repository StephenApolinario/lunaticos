// Simulação da saída para o visor navegador. Funções puras: recebem o estado e devolvem o próximo.
//
// Difere da simulação compartilhada em dois pontos:
// - o ritmo é SIMULADO pelo declive (terreno.js), então o relógio pode adiantar ou atrasar em relação ao plano;
// - existe a caminhada livre, em que a posição vem do teclado e o progresso é a projeção na rota.

import { SIM } from '../../src/simulation.js';
import { STOP_HOURS } from '../../data/travessia.js';
import { clamp } from '../../src/geo.js';
import { headingAt } from '../../src/route.js';
import { routeAt } from './analise.js';
import { projectOnRoute } from './terreno.js';

const SECONDS_PER_HOUR = 3600;
const DEG = Math.PI / 180;

export const FREE = Object.freeze({
  turnDegPerS: 70,
  reverseFactor: 0.5,
  maxSimSpeed: 20,
  arriveM: 12,
  searchBackM: 120,
  searchAheadM: 260,
  // O relevo cobre ±3200 m por ±4200 m; a caminhada para um pouco antes da borda.
  halfWidthM: 3150,
  halfDepthM: 4150,
});

export const createNavState = () => Object.freeze({
  distM: 0,
  stopsReached: 0,
  dwellRemainingH: 0,
  paused: false,
  finished: false,
  speed: SIM.defaultSpeed,
  solarEvent: false,
  solarDoseUsv: 0,
  // Horas gastas além do ritmo simulado (parado ou fora da rota, na caminhada livre).
  extraH: 0,
  // Pose da caminhada livre: { x, z, headingDeg, offM, side, movingKmh }. `null` = seguindo a rota.
  free: null,
});

export const patchState = (state, changes) => Object.freeze({ ...state, ...changes });

/** Horas de missão que o ritmo simulado prevê para o ponto atual, com as paradas já feitas. */
export function scheduleH(analysis, state) {
  return routeAt(analysis, state.distM).paceH + state.stopsReached * STOP_HOURS - state.dwellRemainingH;
}

/** Horas de missão de fato decorridas. */
export const elapsedH = (analysis, state) => scheduleH(analysis, state) + state.extraH;

function advanceDwell(state, dtRealS) {
  const dtH = (dtRealS * Math.max(state.speed, SIM.dwellSpeed)) / SECONDS_PER_HOUR;
  return patchState(state, { dwellRemainingH: Math.max(0, state.dwellRemainingH - dtH) });
}

function advanceRail(plan, analysis, state, dtRealS) {
  const here = routeAt(analysis, state.distM);
  const speedMps = (here.speedKmh / 3.6) * analysis.paceOf(here.slopeDeg, here.onFoot);
  const targetM = state.distM + speedMps * dtRealS * state.speed;
  const nextStop = plan.stops[state.stopsReached];
  if (nextStop && targetM >= nextStop.distM) {
    return patchState(state, { distM: nextStop.distM, stopsReached: state.stopsReached + 1, dwellRemainingH: STOP_HOURS });
  }
  if (targetM >= plan.path.totalM) return patchState(state, { distM: plan.path.totalM, finished: true });
  return patchState(state, { distM: targetM });
}

// Janela da rota em que o progresso pode cair: nunca antes da última parada feita nem depois da próxima.
function progressWindow(plan, state) {
  const previousM = state.stopsReached > 0 ? plan.stops[state.stopsReached - 1].distM : 0;
  const nextStop = plan.stops[state.stopsReached];
  return {
    loM: Math.max(state.distM - FREE.searchBackM, previousM),
    hiM: Math.min(state.distM + FREE.searchAheadM, nextStop ? nextStop.distM : plan.path.totalM),
    nextStop,
  };
}

/**
 * @param {{ move: number, turn: number, pitchDeg: number }} input `move` e `turn` de -1 a 1;
 *   `pitchDeg` é a inclinação do chão no sentido do rumo.
 */
function advanceFree(plan, analysis, state, dtRealS, input) {
  const leg = routeAt(analysis, state.distM);
  const headingDeg = (state.free.headingDeg + input.turn * FREE.turnDegPerS * dtRealS + 360) % 360;
  const slopeDeg = input.move >= 0 ? input.pitchDeg : -input.pitchDeg;
  const gait = input.move >= 0 ? input.move : input.move * FREE.reverseFactor;
  const movingKmh = leg.speedKmh * analysis.paceOf(slopeDeg, leg.onFoot) * gait;
  // Acima de 20× um quadro anda mais que o raio de chegada e a parada passaria direto.
  const simSpeed = Math.min(state.speed, FREE.maxSimSpeed);
  const stepM = (movingKmh / 3.6) * dtRealS * simSpeed;
  const x = clamp(state.free.x + Math.sin(headingDeg * DEG) * stepM, -FREE.halfWidthM, FREE.halfWidthM);
  const z = clamp(state.free.z - Math.cos(headingDeg * DEG) * stepM, -FREE.halfDepthM, FREE.halfDepthM);

  const { loM, hiM, nextStop } = progressWindow(plan, state);
  const projected = projectOnRoute(analysis, x, z, loM, hiM);
  const free = { x, z, headingDeg, offM: projected.offM, side: projected.side, movingKmh: Math.abs(movingKmh) };
  const goalM = nextStop ? nextStop.distM : plan.path.totalM;
  const arrived = projected.offM <= FREE.arriveM && projected.distM >= goalM - FREE.arriveM;

  let moved = patchState(state, { free, distM: projected.distM });
  if (arrived && nextStop) {
    moved = patchState(moved, { distM: goalM, stopsReached: state.stopsReached + 1, dwellRemainingH: STOP_HOURS });
  } else if (arrived) {
    moved = patchState(moved, { distM: goalM, finished: true });
  }
  // O relógio anda o tempo todo; o que passa do ritmo simulado vai para `extraH`.
  const dtH = (dtRealS * simSpeed) / SECONDS_PER_HOUR;
  return patchState(moved, { extraH: state.extraH + dtH - (scheduleH(analysis, moved) - scheduleH(analysis, state)) });
}

/** Avança a simulação em `dtRealS` segundos de relógio. */
export function advance(plan, analysis, state, dtRealS, input) {
  if (state.paused || state.finished) return state;
  const beforeH = elapsedH(analysis, state);
  let next;
  if (state.dwellRemainingH > 0) next = advanceDwell(state, dtRealS);
  else if (state.free) next = advanceFree(plan, analysis, state, dtRealS, input);
  else next = advanceRail(plan, analysis, state, dtRealS);
  if (!next.solarEvent) return next;
  const extraRate = SIM.radiationBaseUsvH * (SIM.solarEventFactor - 1);
  return patchState(next, { solarDoseUsv: next.solarDoseUsv + extraRate * (elapsedH(analysis, next) - beforeH) });
}

// Pose da caminhada livre em cima da rota, olhando no sentido dela.
function poseOnRoute(plan, analysis, distM) {
  const at = routeAt(analysis, distM);
  return { x: at.x, z: at.z, headingDeg: headingAt(plan.path, distM), offM: 0, side: 'direita', movingKmh: 0 };
}

/** Salta para um ponto da rota (barra de progresso). */
export function jumpTo(plan, analysis, state, distM) {
  const target = clamp(distM, 0, plan.path.totalM);
  return patchState(state, {
    distM: target,
    // Parada exatamente no ponto do salto ainda não conta: a coleta começa no próximo quadro.
    stopsReached: plan.stops.filter((entry) => entry.distM < target).length,
    dwellRemainingH: 0,
    finished: target >= plan.path.totalM,
    // O salto recomeça do ritmo simulado: o tempo perdido na caminhada livre não vai junto.
    extraH: 0,
    free: state.free ? poseOnRoute(plan, analysis, target) : null,
  });
}

/** Liga ou desliga a caminhada livre. Ao ligar, limita a velocidade da simulação para dar para dirigir. */
export function setFree(plan, analysis, state, enabled) {
  if (!enabled) return patchState(state, { free: null });
  return patchState(state, {
    free: poseOnRoute(plan, analysis, state.distM),
    speed: Math.min(state.speed, FREE.maxSimSpeed),
  });
}
