// Sessão do Guardião: junta motor, análise, regras, alertas e protocolos em um passo
// por quadro, e aplica as ações do astronauta (reconhecer, confirmar, decidir) e do
// painel de demonstração (cenários, barra de posição). Sem DOM: roda também no Node.

import { deriveReadout } from '../../src/simulation.js';
import { SCENARIOS } from './catalog.js';
import {
  createState, patch, advance, jump, positionOf, ratesOf, triggerScenario, clearScenario, applyPatch, release, NAV_HOLD,
} from './engine.js';
import { buildReadout, updateTrends, EMPTY_TRENDS } from './readout.js';
import { detect } from './rules.js';
import { createAlerts, syncAlerts, ackAlert, firstUnacked } from './alerts.js';
import { createProtocols, syncProtocols, conducting, confirmStep, decide, hasPending, stepsOf } from './protocols.js';

// O visor base calcula alvo, rumo, declive e zona de rochas a partir destes campos.
const baseView = (state) => ({
  distM: state.distM, stopsReached: state.stopsReached, dwellRemainingH: state.dwellRemainingH,
  finished: state.finished, solarEvent: false, solarDoseUsv: 0,
});

export const createSession = (plan) => Object.freeze({
  plan, state: createState(), alerts: createAlerts(), protocols: createProtocols(),
  trends: EMPTY_TRENDS, rates: null, r: null, pos: null, ground: null, events: [],
});

const withState = (session, state) => Object.freeze({ ...session, state });

/**
 * Um quadro: avança o tempo, lê o instante, detecta alertas e conduz os protocolos.
 * @param {{ probe: (x: number, z: number) => object }} terrain
 * @param {{ get: Function }} analyzer De `createAnalyzer` (analysis.js).
 */
export function stepSession(session, dtS, terrain, analyzer) {
  const { plan } = session;
  const before = positionOf(plan, session.state);
  const rates = session.rates ?? ratesOf(plan, session.state, terrain.probe(before.x, before.z));
  let state = advance(plan, session.state, dtS, rates);
  const pos = positionOf(plan, state);
  const ground = terrain.probe(pos.x, pos.z);
  const analysis = analyzer.get(plan, state, pos, dtS);
  const r = buildReadout({ plan, state, pos, ground, base: deriveReadout(plan, baseView(state), ground), analysis });
  const trends = updateTrends(session.trends, { pressure: r.pressureKpa, radiation: r.radiationRate, temperature: r.airTempC, altitude: r.altitudeM }, state.clockH - session.state.clockH);

  const alertSync = syncAlerts(session.alerts, detect(r), state.clockH);
  const protocolSync = syncProtocols(session.protocols, alertSync.state.active, state.sheltered, state.clockH);
  const types = protocolSync.events.map((event) => event.type);
  // Protocolo novo (ou decisão reaberta) começa com "pare", a menos que já se esteja indo ao abrigo.
  if ((types.includes('started') || types.includes('reopened')) && state.nav.kind === 'plan' && !state.finished) state = patch(state, { nav: NAV_HOLD });
  // A última emergência acabou: sai do abrigo e retoma o plano.
  if (types.includes('closed') && !hasPending(protocolSync.list)) state = release(state);

  return Object.freeze({
    ...session, state, alerts: alertSync.state, protocols: protocolSync.list, trends, rates: r.rates, r, pos, ground,
    events: [...alertSync.events, ...protocolSync.events],
  });
}

export const setPaused = (session, paused) => withState(session, patch(session.state, { paused }));
export const setSpeed = (session, speed) => withState(session, patch(session.state, { speed }));

/** Liga ou desliga um cenário de demonstração. */
export function toggleScenario(session, id) {
  const { plan, state } = session;
  return withState(session, state.scenarios[id] ? clearScenario(state, id) : triggerScenario(plan, state, id));
}

export function clearScenarios(session) {
  return withState(session, SCENARIOS.reduce((state, scenario) => clearScenario(state, scenario.id), session.state));
}

/** Reconhece um alerta pelo id ou, sem id, o de maior prioridade ainda pendente. */
export function acknowledge(session, id) {
  const target = id ?? firstUnacked(session.alerts)?.id;
  if (!target) return session;
  return Object.freeze({ ...session, alerts: ackAlert(session.alerts, target, session.state.clockH) });
}

// Efeitos que um passo de protocolo tem sobre o traje.
function applyEffect(state, effect) {
  if (effect === 'selante') return applyPatch(state);
  // Reabastecer só existe no veículo: no habitat a saída já terminou.
  if (effect === 'reabastecer' && state.sheltered === 'vehicle') return patch(state, { o2UsedPct: 0, o2LostPct: 0 });
  return state;
}

/** Confirma o passo atual do protocolo em condução. */
export function confirmCurrentStep(session) {
  const current = conducting(session.protocols);
  if (!current) return session;
  const { list, effect } = confirmStep(session.protocols, current.id);
  return Object.freeze({ ...session, protocols: list, state: applyEffect(session.state, effect) });
}

/** Decide seguir a missão ou abortar para o abrigo recomendado. */
export function decideCurrent(session, choice) {
  const current = conducting(session.protocols);
  if (!current || !session.r) return session;
  const protocols = decide(session.protocols, current.id, choice);
  if (protocols === session.protocols) return session;
  let { state } = session;
  if (choice === 'seguir') {
    if (!hasPending(protocols)) state = release(state);
  } else {
    const pick = session.r.picks[current.id];
    // Sem abrigo ao alcance, ou já dentro dele, fica parado.
    if (pick?.target && state.sheltered !== pick.kind) state = patch(state, { nav: Object.freeze({ kind: 'goto', target: pick.target }), sheltered: null, exposure: 1 });
  }
  return Object.freeze({ ...session, protocols, state });
}

/** Barra de posição: salta na rota. Quem estava indo a um abrigo volta a decidir, porque a posição mudou. */
export function scrubTo(session, fraction) {
  const { plan } = session;
  let state = jump(plan, session.state, fraction * plan.path.totalM);
  const protocols = Object.freeze(session.protocols.map((instance) => {
    const steps = stepsOf(instance.id);
    if (instance.done || steps[instance.step].type !== 'go') return instance;
    return { ...instance, decision: null, step: instance.step - 1 };
  }));
  if (hasPending(protocols) && !state.finished) state = patch(state, { nav: NAV_HOLD });
  return Object.freeze({ ...session, state, protocols, trends: EMPTY_TRENDS });
}
