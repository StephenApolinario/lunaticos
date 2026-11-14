// Adaptador do assistente: monta o contexto que o motor de conversa do Cientista entende
// (formato `AssistantContext`, em ../cientista/assistente.js) a partir da sessão do Guardião,
// e responde em cima dele. Lógica pura: roda no Node (ver check.mjs).
//
// O protocolo em condução é o do Guardião (confirmar, decidir, ir ao abrigo, encerrar), que o
// motor do Cientista não conhece. Por isso `context.protocol` vai sempre nulo e quem responde
// sobre o protocolo é `answerUnified`, antes de cair nas regras do Cientista.

import { SIM } from '../../src/simulation.js';
import { fmtDistance, fmtDuration } from '../../src/format.js';
import { LEVELS, PROTOCOLS } from '../guardiao/catalog.js';
import { shelterLine } from '../guardiao/rules.js';
import { buildContext } from '../cientista/contexto.js';
import { answerByRules, quickQuestions, normalize } from '../cientista/assistente.js';

// Os quatro níveis do Guardião nas três severidades que o assistente do Cientista lê.
const SEVERITY = Object.freeze({ emergencia: 'critico', perigo: 'critico', atencao: 'atencao', info: 'info' });

const STEP_DONE = /^(feito|pronto|ok|okay|certo|confirmo|confirmado|concluido|sim|passo feito|proximo( passo)?|passo seguinte|seguinte|ja fiz|entendido)$/;
const STEP_REPEAT = /\b(repet\w*|de novo|qual (e )?o passo|passo atual)\b/;
const DECIDE_ABORT = /^(abortar?|aborte|aborto|abrigar|recuar|voltar|ir (para|pro|ao) (o )?abrigo)\b/;
const DECIDE_GO_ON = /^(seguir|sigo|segue|siga|continuar?|prosseguir)( (a|com a) missao| em frente)?$/;
const WHERE_TO = /\b(para onde|pra onde|por onde|que direcao|qual (e )?a direcao|viro|virar|curva|rumo|instrucao|manobra)\b/;
const ABOUT_DECISION = /\b(abort\w*|segu\w*|decid\w*|decis\w*|recomend\w*)\b/;
const ABOUT_PROTOCOL = /\b(protocolo|passos?|disso|isso|desse|deste)\b/;
const ABOUT_HABITAT = /\b(habitat|base)\b/;

const NO_PROTOCOL_TEXT = `Nenhuma emergência em andamento. Se houver, eu conduzo o protocolo passo a passo (confirmar, decidir, ir ao abrigo, encerrar) para: ${Object.values(PROTOCOLS).map((protocol) => `“${protocol.name}”`).join(', ')}. Pergunte, por exemplo, “o que fazer numa tempestade de poeira?”.`;

/** Alertas do Guardião (já em ordem de prioridade) no formato que o assistente lê. */
export const alertsForAssistant = (active) => active.map((alert) => ({
  kind: alert.id,
  key: alert.id,
  level: SEVERITY[alert.level],
  text: `${alert.title} (${LEVELS[alert.level].label.toLowerCase()})`,
  action: alert.action,
}));

// Parada, coleta e retorno já vêm no formato da simulação compartilhada. Abrigo e fim de saída
// não têm equivalente lá: viram um retorno ao habitat com o nome do alvo.
function targetFor({ target }) {
  if (target.stop) return target;
  return { kind: 'return', stop: { id: 'H' }, name: target.name, label: target.label, distM: target.distM, etaH: target.etaH, gainM: target.gainM };
}

// Ponto sem volta: o do Guardião, que parte do oxigênio de agora (o do plano só vale sem imprevisto).
function noReturnFor(plan, r, distM) {
  if (r.pnr.status === 'none') return null;
  if (r.pnr.status === 'ahead') return { distM: r.pnr.distM, aheadM: r.pnr.aheadM };
  const planned = plan.safety?.noReturn?.distM;
  const at = planned !== undefined && planned < distM ? planned : distM;
  return { distM: at, aheadM: at - distM };
}

function protocolFor(proto, scenarios) {
  if (!proto) return null;
  return Object.freeze({
    id: proto.id,
    name: PROTOCOLS[proto.id].name,
    title: proto.title,
    source: proto.source,
    stepNumber: proto.stepNumber,
    stepCount: proto.steps.length,
    stepType: proto.current.type,
    stepText: proto.current.text,
    abort: proto.recommendation.abort,
    why: proto.recommendation.why,
    shelter: shelterLine(proto.pick),
    // Aberto por um cenário de demonstração (dá para encerrar) ou pela telemetria (não dá).
    simulated: Boolean(scenarios[proto.id]),
  });
}

function goingText({ target }) {
  if (target.kind !== 'shelter') return null;
  const howFar = target.timeOnly ? `cerca de ${fmtDuration(target.etaH)} a pé` : `a ${fmtDistance(target.distM)}, cerca de ${fmtDuration(target.etaH)}`;
  return `Você está indo ao abrigo: ${target.name.toLowerCase()}, ${howFar}.`;
}

/**
 * Contexto do assistente a partir da sessão do Guardião.
 * @param {{
 *   session: object, proto: object|null, alerts: ReadonlyArray<object>,
 *   guidance: { text: string, radio: string|null } | null,
 *   stops: ReadonlyArray<object>, hazards: ReadonlyArray<object>, outingId: string, journal: object,
 *   protocols: Record<string, object>, assumptions: object,
 * }} input
 *   `session` de `stepSession` (com `r` já calculado); `proto` de `protocolView`; `alerts` é a lista
 *   ativa do Guardião (com o perigo relatado, se houver); `guidance` vem de guia.js;
 *   `stops` de `describeStops`; `hazards` de `createHazardStore().list()`; `journal` de
 *   `createJournal().stats()`; `protocols` de `bindProtocols`; `assumptions` de `context.safety`.
 * @returns {import('../cientista/assistente.js').AssistantContext & { guardiao: object }}
 */
export function assistantContext({ session, proto, alerts, guidance, stops, hazards, outingId, journal, protocols, assumptions }) {
  const { plan, state, r, pos } = session;
  const relief = r.shelters.find((option) => option.kind === 'terrain');
  const base = buildContext({
    plan, stops, hazards, outingId, journal, protocols, assumptions,
    protocol: null,
    state: {
      finished: state.finished, paused: state.paused, stopsReached: state.stopsReached,
      dwellRemainingH: state.dwellRemainingH, solarEvent: Boolean(state.scenarios.solar),
    },
    readout: {
      here: pos,
      heading: r.heading,
      elapsedH: r.clockH,
      clockH: r.localClockH,
      target: targetFor(r),
      // Margem: quantas horas de O₂ sobram ao fim do plano, pela projeção do Guardião.
      suit: { o2Pct: r.o2Pct, batteryPct: r.batteryPct, marginH: r.o2EndPct / SIM.o2PctPerHour.foot },
      slopeDeg: r.slopeDeg,
      slopeAheadDeg: r.slopeAheadDeg,
      radiationRate: r.radiationRate,
      doseUsv: r.doseUsv,
      airTempC: r.airTempC,
      hazard: r.hazard,
    },
    emergencies: { storm: Boolean(state.scenarios.poeira), radio: r.radio.state === 'lost', o2: false },
    walkBackH: r.ret.timeH,
    shelter: { terrain: relief ? { distM: relief.distM, walkH: relief.timeH, skyBlocked: relief.skyBlocked } : null },
    alerts: alertsForAssistant(alerts),
  });
  return {
    ...base,
    // Onde o Guardião sabe mais que a simulação compartilhada (fora da rota, vazamento, pane), vale ele.
    position: { ...base.position, elevM: r.altitudeM, onFoot: !r.m.inCabin },
    suit: { ...base.suit, batteryEndPct: r.batteryEndPct, hoursToFinish: r.planRemainingH, leaking: r.leakPctH > 0 },
    habitat: { ...base.habitat, o2UsePct: r.ret.o2NeedPct, o2ArrivalPct: r.ret.o2AfterPct },
    noReturn: noReturnFor(plan, r, state.distM),
    guardiao: Object.freeze({ protocol: protocolFor(proto, state.scenarios), going: goingText(r), guidance }),
  };
}

const reply = (intent, text, action = null) => ({ intent, text, action });
const stepLine = (protocol) => `Passo ${protocol.stepNumber} de ${protocol.stepCount}: ${protocol.stepText}`;
const adviceLine = (protocol) => `${protocol.abort ? 'Recomendo abortar' : 'Recomendo seguir'}: ${protocol.why}.${protocol.abort ? ` ${protocol.shelter}` : ''}`;

// Condução do protocolo do Guardião pela conversa. Devolve null se a frase não é sobre o passo atual.
// Como no Cientista, comando é ordem direta: uma pergunta ("devo abortar?") nunca decide nem confirma.
function answerProtocol(raw, norm, protocol) {
  const isOrder = !raw.trim().endsWith('?');
  if (STEP_REPEAT.test(norm)) return reply('protocolo-repetir', `${protocol.name}. ${stepLine(protocol)}`);
  if (protocol.stepType === 'decision') {
    if (isOrder && DECIDE_ABORT.test(norm)) return reply('protocolo-decidir', '', { type: 'protocol-decide', choice: 'abortar' });
    if (isOrder && DECIDE_GO_ON.test(norm)) return reply('protocolo-decidir', '', { type: 'protocol-decide', choice: 'seguir' });
    if (STEP_DONE.test(norm) || ABOUT_DECISION.test(norm)) return reply('protocolo-decisao', `Este passo é uma decisão sua: diga “abortar” ou “seguir”. ${adviceLine(protocol)}`);
    return null;
  }
  if (!isOrder || !STEP_DONE.test(norm)) return null;
  if (protocol.stepType === 'ok') return reply('protocolo-avancar', '', { type: 'protocol-advance' });
  return reply('protocolo-ida', `Este passo fecha sozinho quando você chegar ao abrigo. ${protocol.stepText}`);
}

/**
 * Motor de resposta do visor único (para `createConversation({ engine })`): primeiro o que só o
 * Guardião e o Navegador sabem (passo do protocolo, para onde ir), depois as regras do Cientista.
 * @returns {{ intent: string, text: string, action: { type: string } | null }}
 */
export function answerUnified(question, context) {
  const own = context?.guardiao;
  if (!own) return answerByRules(question, context);
  const norm = normalize(question);
  const { protocol } = own;
  const conducted = protocol ? answerProtocol(String(question ?? ''), norm, protocol) : null;
  if (conducted) return conducted;
  if (own.guidance && WHERE_TO.test(norm)) return reply('navegacao', own.guidance.text);

  const base = answerByRules(question, context);
  // ponytail: reconhece a resposta genérica do Cientista pelo começo do texto (ele fala em quatro
  // protocolos; aqui são os oito do Guardião). Trocar por um campo no retorno se o motor ganhar um.
  if (!protocol && base.intent === 'protocolo' && base.text.startsWith('Nenhuma emergência')) return { ...base, text: NO_PROTOCOL_TEXT };
  if (protocol && base.intent === 'protocolo') {
    const advice = protocol.stepType === 'decision' ? ` ${adviceLine(protocol)}` : '';
    return { ...base, text: `Protocolo em condução: ${protocol.title}. ${stepLine(protocol)}${advice}` };
  }
  if (protocol && base.intent === 'fonte' && ABOUT_PROTOCOL.test(norm)) {
    return { ...base, text: `Base do protocolo “${protocol.title}”: ${protocol.source}. Os passos são proposta do protótipo, não procedimento oficial da NASA.` };
  }
  if (own.going && base.intent === 'quanto-falta' && !ABOUT_HABITAT.test(norm)) return { ...base, text: own.going };
  if (own.guidance?.radio && base.intent === 'comunicacao' && !context.comms.failed) return { ...base, text: `${base.text} Seguindo a rota, o sinal ${own.guidance.radio}.` };
  return base;
}

/** Perguntas rápidas: as do protocolo em condução primeiro, depois as do Cientista. */
export function unifiedQuickQuestions(context) {
  const protocol = context.guardiao?.protocol;
  const common = quickQuestions(context);
  if (!protocol) return [['Para onde agora?', 'Para onde eu vou agora?'], ...common];
  let step = [];
  if (protocol.stepType === 'ok') step = [['Passo feito', 'feito']];
  if (protocol.stepType === 'decision') step = [['Abortar', 'abortar'], ['Seguir a missão', 'seguir']];
  return [...step, ['Repetir passo', 'repetir o passo'], ['Encerrar emergência', 'encerrar emergência'], ...common];
}
