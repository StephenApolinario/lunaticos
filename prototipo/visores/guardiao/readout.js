// Leitura completa de um instante: tudo o que o HUD mostra e que as regras consultam.

import { estimatedAirTempC } from '../../src/clima.js';
import { SIM, localClockOf } from '../../src/simulation.js';
import { headingDeg, yToElev } from '../../src/geo.js';
import { samplePath, maxSlopeAheadDeg } from '../../src/route.js';
import { RULES, FAULTS, SHELTER_NAMES } from './catalog.js';
import { effects, mobility, ratesOf, o2PctOf, batteryPctOf } from './engine.js';

const AT_TARGET_M = 1;
const M_PER_KM = 1000;
const TREND_TAU_H = 0.08;
// Variação mínima (na unidade de cada leitura) para a seta de tendência aparecer.
const TREND_DEADBAND = Object.freeze({ pressure: 0.05, radiation: 2, temperature: 0.6, altitude: 1.5 });

export const EMPTY_TRENDS = Object.freeze({ ema: Object.freeze({}), dir: Object.freeze({}) });

/** Tendência por média móvel: compara a leitura com a média dos últimos minutos de missão. */
export function updateTrends(previous, values, dtH) {
  const blend = 1 - Math.exp(-dtH / TREND_TAU_H);
  const ema = {};
  const dir = {};
  for (const [key, value] of Object.entries(values)) {
    const before = previous.ema[key] ?? value;
    ema[key] = before + (value - before) * blend;
    const delta = value - ema[key];
    dir[key] = Math.abs(delta) < TREND_DEADBAND[key] ? 'flat' : delta > 0 ? 'up' : 'down';
  }
  return { ema, dir };
}

// Seta do consumo: vem direto da taxa, que o motor conhece.
const drainTrend = (ratePctH, nominalPctH) => (ratePctH < 0.1 ? 'flat' : ratePctH > nominalPctH * 1.3 ? 'down2' : 'down');

function bearingTo(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) < AT_TARGET_M ? null : headingDeg(dx, dz);
}

// Para onde se está indo agora: a próxima parada do plano ou o abrigo escolhido.
function currentTarget(plan, state, pos, m, base) {
  if (state.finished) return { kind: 'home', label: 'Saída encerrada', name: 'Habitat', distM: 0, etaH: 0, gainM: 0, position: pos, stopId: 'H' };
  if (state.nav.kind !== 'goto') return { ...base.target, stopId: base.target.stop.id };
  const { target } = state.nav;
  const onRoute = target.kind !== 'terrain';
  const position = onRoute ? samplePath(plan.path, target.distM) : target;
  const distM = onRoute && !state.off ? Math.abs(target.distM - state.distM) : Math.hypot(position.x - pos.x, position.z - pos.z);
  const speedKmh = m.driving ? m.speedKmh : target.paceKmh ?? m.speedKmh;
  return {
    kind: 'shelter', label: 'Indo ao abrigo', name: SHELTER_NAMES[target.kind], distM, etaH: distM / M_PER_KM / speedKmh,
    // Com ritmo ajustado, a distância pela linha da rota não é a do caminho real: mostra só o tempo.
    timeOnly: target.paceKmh !== undefined,
    gainM: onRoute ? position.elev - m.here.elev : 0, position, stopId: target.kind === 'habitat' ? 'H' : null,
  };
}

/**
 * @param {{ plan: object, state: object, pos: object, ground: { y: number, slopeDeg: number, radiation: number, groundTemp: number },
 *   base: object, analysis: object }} input `base` é a leitura do visor base; `analysis` vem de analysis.js.
 */
export function buildReadout({ plan, state, pos, ground, base, analysis }) {
  const fx = effects(state);
  const m = mobility(plan, state);
  const rates = ratesOf(plan, state, ground);
  const o2Pct = o2PctOf(state);
  const batteryPct = batteryPctOf(state);
  const localClockH = localClockOf(plan, state.clockH);
  const target = currentTarget(plan, state, pos, m, base);
  const backward = state.nav.kind === 'goto' && target.kind === 'shelter' && state.nav.target.kind !== 'terrain' && state.nav.target.distM < state.distM;
  const dwelling = state.nav.kind === 'plan' && state.dwellRemainingH > 0;
  const moving = !state.paused && !state.finished && state.nav.kind !== 'hold' && !dwelling;

  let heading = base.heading;
  let slopeDeg = base.slopeDeg;
  let slopeAheadDeg = base.slopeAheadDeg;
  if (backward) {
    heading = (base.heading + 180) % 360;
    slopeDeg = -base.slopeDeg;
    slopeAheadDeg = maxSlopeAheadDeg(plan.path, Math.max(0, state.distM - SIM.slopeLookaheadM), SIM.slopeLookaheadM, SIM.slopeStepM);
  }
  if (state.off) {
    // Fora da rota não há perfil: vale o declive do DEM no ponto.
    const goal = state.nav.kind === 'goto' && state.nav.target.kind === 'terrain' ? state.nav.target : m.here;
    heading = bearingTo(pos, goal) ?? base.heading;
    slopeDeg = ground.slopeDeg;
    slopeAheadDeg = ground.slopeDeg;
  }

  // Rádio: a falha simulada manda; sem ela vale a linha de visada calculada no relevo.
  let { radio } = fx;
  if (radio.state === 'ok' && !analysis.comms.visible) radio = { state: 'shadow', lostH: 0 };
  const doseLeftUsv = RULES.doseLimitUsv - state.doseUsv;
  return {
    plan, mode: plan.mode, fx, m, rates, nav: state.nav,
    finished: state.finished, sheltered: state.sheltered, offRoute: Boolean(state.off), moving,
    clockH: state.clockH, localClockH, startClockH: plan.startClockH ?? SIM.startClockH,
    heading, target, targetBearing: bearingTo(pos, target.position),
    dwell: dwelling ? { stop: plan.stops[state.stopsReached - 1].stop, remainingH: state.dwellRemainingH } : null,
    o2Pct, o2RatePctH: rates.o2PctH, o2AutonomyH: rates.o2PctH > 0 ? o2Pct / rates.o2PctH : Infinity,
    o2Trend: drainTrend(rates.o2PctH, SIM.o2PctPerHour.foot),
    batteryPct, batteryRatePctH: rates.batteryPctH, batteryTrend: drainTrend(rates.batteryPctH, SIM.batteryPctPerHour.foot),
    integrityPct: state.integrityPct, patched: state.patched, leakPctH: fx.leakPctH,
    pressureKpa: RULES.pressureNominalKpa * (1 - FAULTS.pressureDropPerPoint * (100 - state.integrityPct)),
    radiationRate: rates.doseUsvH, doseUsv: state.doseUsv,
    doseEtaH: doseLeftUsv > 0 ? doseLeftUsv / rates.doseUsvH : 0,
    airTempC: estimatedAirTempC(localClockH) + fx.tempOffsetC,
    windMps: fx.windMps, radio, comms: analysis.comms,
    slopeDeg, slopeAheadDeg, altitudeM: state.off ? yToElev(ground.y) : m.here.elev,
    hazard: base.hazard,
    ret: analysis.ret, pnr: analysis.pnr, zones: analysis.zones, progress: state.distM / plan.path.totalM,
    o2EndPct: analysis.o2EndPct, batteryEndPct: analysis.batteryEndPct, planRemainingH: analysis.planRemainingH,
    shelters: analysis.shelters, picks: analysis.picks, nearestShelter: analysis.nearest,
  };
}
