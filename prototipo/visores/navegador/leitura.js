// Leitura de um instante: tudo o que o HUD e o assistente mostram, mais os alertas por severidade.
//
// Real: posição, distâncias, altitude, inclinação e declive (relevo USGS) e a geometria do rádio.
// Simulado: traje, radiação, temperatura e ritmo. Cada bloco do HUD diz qual é qual.

import { STOP_HOURS } from '../../data/travessia.js';
import { SIM } from '../../src/simulation.js';
import { toLocal, headingDeg, yToElev, clamp } from '../../src/geo.js';
import { samplePath, shortName, findStop } from '../../src/route.js';
import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { routeAt, slopeAhead, radioAhead, HABITAT } from './analise.js';
import { elapsedH } from './sim.js';
import { hazardStatus, slopeLevel, limitFor } from './terreno.js';

export const NAV = Object.freeze({
  offRouteM: Object.freeze({ foot: 25, cabin: 40 }),
  farOffRouteFactor: 4,
  rejoinLeadM: Object.freeze({ min: 25, max: 90 }),
  slopeLookaheadM: 60,
  radioWarnMin: 4,
  radioMarginalM: 3,
  radioMinGapM: 40,
  o2ReservePct: 10,
  paceOnPlanMin: 3,
  paceLateMin: 15,
  batteryLowPct: 20,
  stopRiskM: 150,
  atTargetM: 1,
});

const LEVEL_RANK = Object.freeze({ danger: 0, warn: 1, info: 2 });

export const fmtBearing = (deg) => `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
export const fmtMinutes = (minutes) => (minutes < 60 ? `${minutes} min` : fmtDuration(minutes / 60));

// Cópia de `nextTarget` de src/simulation.js, que não é exportada (pedido registrado em NOTAS.md).
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

// Consumo SIMULADO do traje, pelas horas de fato decorridas. A margem é o que sobra depois de
// terminar o plano no ritmo simulado.
// ponytail: o tempo extra da caminhada livre conta inteiro como fora da cabine (pior caso).
function suitStatus(plan, analysis, state, route) {
  const dwellDoneH = state.stopsReached * STOP_HOURS - state.dwellRemainingH;
  const footH = route.paceFootH + dwellDoneH + state.extraH;
  const cabinH = route.paceH - route.paceFootH;
  const usedPct = (rates) => rates.foot * footH + rates.cabin * cabinH;
  const o2Pct = clamp(100 - usedPct(SIM.o2PctPerHour), 0, 100);

  const dwellLeftH = (plan.stops.length - state.stopsReached) * STOP_HOURS + state.dwellRemainingH;
  const footLeftH = analysis.paceFootTotalH - route.paceFootH + dwellLeftH;
  const cabinLeftH = analysis.paceTotalH - analysis.paceFootTotalH - cabinH;
  const o2NeededPct = SIM.o2PctPerHour.foot * footLeftH + SIM.o2PctPerHour.cabin * cabinLeftH;
  return {
    o2Pct,
    batteryPct: clamp(100 - usedPct(SIM.batteryPctPerHour), 0, 100),
    marginH: (o2Pct - o2NeededPct) / SIM.o2PctPerHour.foot,
    hoursToFinish: footLeftH + cabinLeftH,
  };
}

// Caminho mais rápido até o habitat sem sair da rota: voltar pela ida ou seguir em frente
// (sem as coletas que faltam). Tempo na velocidade do plano.
function shortestReturn(plan, here, suit) {
  const { path } = plan;
  const back = { via: 'back', distM: here.distM, timeH: here.travelH, footH: here.footH };
  const forward = { via: 'forward', distM: path.totalM - here.distM, timeH: path.totalTravelH - here.travelH, footH: path.totalFootH - here.footH };
  const best = back.timeH <= forward.timeH ? back : forward;
  const o2Pct = SIM.o2PctPerHour.foot * best.footH + SIM.o2PctPerHour.cabin * (best.timeH - best.footH);
  return { via: best.via, distM: best.distM, timeH: best.timeH, o2AfterPct: suit.o2Pct - o2Pct };
}

// Ponto da rota, um pouco à frente da projeção, por onde retomar o caminho.
function rejoinPoint(plan, analysis, state, pose) {
  const leadM = clamp(pose.offM, NAV.rejoinLeadM.min, NAV.rejoinLeadM.max);
  const nextStop = plan.stops[state.stopsReached];
  const at = routeAt(analysis, Math.min(state.distM + leadM, nextStop ? nextStop.distM : plan.path.totalM));
  const dx = at.x - pose.x;
  const dz = at.z - pose.z;
  return { x: at.x, z: at.z, distM: Math.hypot(dx, dz), bearingDeg: headingDeg(dx, dz) };
}

// Ponto sem volta a pé, de `plan.safety.noReturn` (src/safety.js): o primeiro ponto da rota em que
// o oxigênio não cobre a caminhada de volta com a reserva. `null` se o plano não tem um.
function noReturnStatus(plan, state) {
  const point = plan.safety?.noReturn;
  if (!point) return null;
  return { aheadM: point.distM - state.distM, passed: state.distM >= point.distM, noWalkRoute: Boolean(point.noWalkRoute) };
}

// Volta a pé a partir de onde se está, com o tempo de `context.safety.walkBackAt` e o oxigênio de agora.
// `covered` = chega ao habitat ainda com a reserva. `null` quando o contexto não traz o roteador.
function walkBackStatus(walkBackH, suit, reservePct) {
  if (walkBackH == null) return null;
  if (!Number.isFinite(walkBackH)) return { walkH: Infinity, o2AfterPct: -Infinity, covered: false, noRoute: true };
  const o2AfterPct = suit.o2Pct - SIM.o2PctPerHour.foot * walkBackH;
  return { walkH: walkBackH, o2AfterPct, covered: o2AfterPct >= reservePct, noRoute: false };
}

// Rumo até um ponto, ou null quando já se está em cima dele.
function bearingTo(pose, point) {
  const dx = point.x - pose.x;
  const dz = point.z - pose.z;
  return Math.hypot(dx, dz) < NAV.atTargetM ? null : headingDeg(dx, dz);
}

function paceStatus(planH, elapsed) {
  const deltaMin = Math.round((planH - elapsed) * 60);
  if (Math.abs(deltaMin) < NAV.paceOnPlanMin) return { deltaMin, text: 'no plano', level: 'ok' };
  if (deltaMin > 0) return { deltaMin, text: `adiantado ${fmtMinutes(deltaMin)}`, level: 'ok' };
  return { deltaMin, text: `atrasado ${fmtMinutes(-deltaMin)}`, level: -deltaMin >= NAV.paceLateMin ? 'warn' : 'ok' };
}

function movingKmh(analysis, state, route, pose) {
  if (state.paused || state.finished || state.dwellRemainingH > 0) return 0;
  if (pose.free) return pose.movingKmh;
  return route.speedKmh * analysis.paceOf(route.slopeDeg, route.onFoot);
}

function terrainReading(analysis, state, pose, attitude, aheadFree, onFoot) {
  const limitDeg = limitFor(onFoot);
  const ahead = pose.free && aheadFree ? aheadFree : slopeAhead(analysis, state.distM, NAV.slopeLookaheadM);
  return {
    ...attitude,
    limitDeg,
    level: slopeLevel(attitude.slopeDeg, limitDeg),
    rollLevel: slopeLevel(Math.abs(attitude.rollDeg), limitDeg),
    aheadDeg: ahead.deg,
    aheadInM: ahead.inM,
    aheadLevel: slopeLevel(Math.abs(ahead.deg), limitDeg),
  };
}

/**
 * Leitura do rádio: a visada na posição atual mais o que a rota reserva.
 * Não depende do resto da leitura, para poder ser usada por outro visor.
 * @param {object} analysis Resultado de `analyzePlan`.
 * @param {number} distM Distância percorrida na rota.
 * @param {{ visible: boolean, clearanceM: number, blockAtM: number, distM: number }} radioNow Visada agora.
 * @param {number} planSpeedKmh Velocidade do plano no trecho, para converter distância em tempo.
 * @returns {object} `radioNow` mais `status` ('clear'|'marginal'|'blocked'), `route` (de `radioAhead`),
 *   `changeInH`, e a próxima perda que vale avisar: `lossInM`, `lossLengthM` e `lossSoon` (em poucos minutos).
 */
export function radioReading(analysis, distM, radioNow, planSpeedKmh) {
  const route = radioAhead(analysis, distM);
  let status = 'blocked';
  if (radioNow.visible) status = radioNow.clearanceM < NAV.radioMarginalM ? 'marginal' : 'clear';
  const changeInH = route.changeInM === null ? null : route.changeInM / 1000 / planSpeedKmh;
  // A perda que vale alerta é o próximo trecho sem rádio de 40 m ou mais: um corte curto antes dele não conta.
  const loss = analysis.radioSegments.find((segment) => !segment.visible && segment.fromM > distM && segment.toM - segment.fromM >= NAV.radioMinGapM);
  const lossInM = loss ? loss.fromM - distM : null;
  const lossSoon = radioNow.visible && lossInM !== null && (lossInM / 1000 / planSpeedKmh) * 60 <= NAV.radioWarnMin;
  return { ...radioNow, status, route, changeInH, lossInM, lossLengthM: loss ? loss.toM - loss.fromM : 0, lossSoon };
}

// Temperatura do ar SIMULADA: mesma curva de src/simulation.js (lá não é exportada).
function airTemperature(clockH, groundTemp) {
  const daylight = Math.max(0, Math.sin((Math.PI * (clockH - 6)) / 13));
  return -52 + 34 * daylight + (groundTemp + 19) * 0.25;
}

// O risco mais relevante por perto. O texto de risco das paradas vem dos dados da travessia.
function nearbyRisk(r) {
  const { hazard, terrain, target, here, mode } = r;
  if (hazard.inside) return { level: 'danger', text: 'rochas cortantes: dentro da zona' };
  if (hazard.near) return { level: 'warn', text: `rochas cortantes a ${fmtDistance(hazard.edgeM)} ${hazard.side}` };
  if (terrain.level === 'over' || terrain.aheadLevel === 'over') return { level: 'danger', text: 'declive acima do limite' };
  if (terrain.aheadLevel === 'near') return { level: 'warn', text: 'declive perto do limite' };
  if (target.kind !== 'return' && target.distM < NAV.stopRiskM && target.stop.risk) return { level: 'info', text: target.stop.risk.toLowerCase() };
  if (mode === 'car' && here.onFoot) return { level: 'info', text: 'trecho bloqueado para veículo: a pé' };
  return { level: 'ok', text: 'nenhum mapeado' };
}

function buildAlerts(state, r) {
  const alerts = [];
  const add = (kind, level, text) => alerts.push({ kind, level, text });
  const { suit, hazard, terrain, radio, pace, pose, rejoin, walkBack } = r;
  const deg = (value) => `${fmtNumber(Math.abs(value))}°`;

  if (state.solarEvent) add('solar', 'danger', `Evento solar · dose ${SIM.solarEventFactor}× acima do normal`);
  if (suit.marginH < 0) add('o2-short', 'danger', `O₂ insuficiente para o plano · faltam ${fmtDuration(-suit.marginH)}`);
  else if (suit.marginH < SIM.lowMarginH) add('o2-low', 'warn', `Margem de O₂ baixa · ${fmtDuration(suit.marginH)}`);
  if (suit.batteryPct < NAV.batteryLowPct) add('battery', 'warn', `Bateria baixa · ${fmtNumber(suit.batteryPct)}%`);

  if (hazard.inside) add('hazard-in', 'danger', `Dentro da zona de rochas cortantes · saia no rumo ${fmtBearing(hazard.exitBearingDeg)}`);
  else if (hazard.near) add('hazard', 'warn', `Rochas cortantes a ${fmtDistance(hazard.edgeM)} ${hazard.side}`);
  if (rejoin) {
    const far = pose.offM > r.offRouteLimitM * NAV.farOffRouteFactor;
    add('off-route', far ? 'danger' : 'warn', `Fora da rota · ${fmtNumber(pose.offM)} m à ${pose.side} · retome no rumo ${fmtBearing(rejoin.bearingDeg)}`);
  }

  if (terrain.level === 'over') add('slope-here', 'danger', `Declive de ${deg(terrain.slopeDeg)} sob os pés · limite ${terrain.limitDeg}°`);
  else if (terrain.rollLevel === 'near' || terrain.rollLevel === 'over') {
    add('roll', 'warn', `Tombo lateral de ${deg(terrain.rollDeg)} à ${terrain.rollDeg >= 0 ? 'direita' : 'esquerda'}`);
  }
  if (terrain.aheadLevel === 'over') add('slope', 'danger', `Declive de ${deg(terrain.aheadDeg)} à frente · acima do limite de ${terrain.limitDeg}°`);
  else if (terrain.aheadLevel === 'near') add('slope', 'warn', `Declive de ${deg(terrain.aheadDeg)} à frente · limite ${terrain.limitDeg}°`);

  if (radio.lossSoon) add('radio-loss', 'warn', `Rádio cai em ${fmtDistance(radio.lossInM)} · reporte a posição antes`);
  else if (radio.status === 'blocked') add('radio-out', 'info', 'Sem visada de rádio ao habitat');
  if (pace.level === 'warn') add('late', 'warn', `Atrasado ${fmtMinutes(-pace.deltaMin)} em relação ao plano`);
  if (r.stranded && !state.finished) {
    add('no-return', 'info', walkBack?.noRoute ? 'Sem caminho a pé até o habitat a partir daqui' : 'O₂ não cobre a volta a pé com a reserva');
  }

  return alerts.map((alert, order) => ({ ...alert, order })).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.order - b.order);
}

/**
 * @param {object} input
 * @param {object} input.plan
 * @param {object} input.analysis Resultado de `analyzePlan`.
 * @param {object} input.state Estado de `sim.js`.
 * @param {{ x: number, z: number, headingDeg: number, free: boolean, offM: number, side: string, movingKmh: number }} input.pose
 * @param {{ y: number, radiation: number, groundTemp: number }} input.ground Leitura de `terrain.probe` na posição.
 * @param {{ pitchDeg: number, rollDeg: number, slopeDeg: number }} input.attitude
 * @param {{ deg: number, inM: number } | null} input.aheadFree Declive no rumo atual (caminhada livre).
 * @param {{ visible: boolean, clearanceM: number, blockAtM: number, distM: number }} input.radioNow
 * @param {number|null} [input.walkBackH] Horas de caminhada até o habitat (`context.safety.walkBackAt`).
 * @param {number} [input.o2ReservePct] Reserva de oxigênio que a volta a pé precisa preservar.
 */
export function deriveReadout({ plan, analysis, state, pose, ground, attitude, aheadFree, radioNow, walkBackH = null, o2ReservePct = NAV.o2ReservePct }) {
  const here = samplePath(plan.path, state.distM);
  const route = routeAt(analysis, state.distM);
  const elapsed = elapsedH(analysis, state);
  const planH = here.travelH + state.stopsReached * STOP_HOURS - state.dwellRemainingH;
  const clockH = SIM.startClockH + elapsed;
  const target = nextTarget(plan, state, here);
  const suit = suitStatus(plan, analysis, state, route);
  const offRouteLimitM = here.onFoot ? NAV.offRouteM.foot : NAV.offRouteM.cabin;
  const rejoin = pose.free && pose.offM > offRouteLimitM && target.kind !== 'dwell' ? rejoinPoint(plan, analysis, state, pose) : null;
  const guide = rejoin ?? target.position;
  const noReturn = noReturnStatus(plan, state);
  const walkBack = walkBackStatus(walkBackH, suit, o2ReservePct);

  const readout = {
    mode: plan.mode,
    here,
    pose,
    elevM: yToElev(ground.y),
    elapsedH: elapsed,
    clockH,
    pace: paceStatus(planH, elapsed),
    movingKmh: movingKmh(analysis, state, route, pose),
    target,
    guide,
    rejoin,
    offRouteLimitM,
    targetBearing: bearingTo(pose, guide),
    homeBearing: bearingTo(pose, HABITAT),
    home: { distM: plan.path.totalM - here.distM, timeH: suit.hoursToFinish },
    back: shortestReturn(plan, here, suit),
    noReturn,
    walkBack,
    // Sem o roteador, vale o ponto do plano, e só na ida: na volta ele já ficou para trás de vez.
    stranded: walkBack ? !walkBack.covered : Boolean(noReturn?.passed) && state.stopsReached < plan.stops.length,
    suit,
    terrain: terrainReading(analysis, state, pose, attitude, aheadFree, here.onFoot),
    hazard: hazardStatus(pose.x, pose.z, pose.headingDeg),
    radio: radioReading(analysis, state.distM, radioNow, here.speedKmh),
    radiationRate: ground.radiation * (state.solarEvent ? SIM.solarEventFactor : 1),
    doseUsv: SIM.radiationBaseUsvH * elapsed + state.solarDoseUsv,
    airTempC: airTemperature(clockH, ground.groundTemp),
  };
  return { ...readout, risk: nearbyRisk(readout), alerts: buildAlerts(state, readout) };
}
