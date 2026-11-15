// Assistente de navegação: motor de REGRAS (não é IA de verdade e não chama serviço externo).
// Escolhe uma instrução principal por prioridade e até três avisos do que vem pela frente.

import { angleDeltaDeg } from '../../src/geo.js';
import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { t, HTML_LANG } from '../../src/i18n.js';
import { nextManeuver, nextSteep, hazardAhead, STEP_M } from './analise.js';
import { NAV, fmtBearing, fmtMinutes } from './leitura.js';

const GUIDE = Object.freeze({
  horizonM: Object.freeze({ foot: 300, cabin: 500 }),
  nowM: 15,
  nearM: 60,
  climbMinDeg: 5,
  advisoryRangeM: 500,
  maxAdvisories: 3,
  stopMarginM: 5,
});
// A frase da curva por tipo e lado. O lado ('direita' ou 'esquerda') é identificador, não texto de tela.
const TURN_PHRASE = Object.freeze({
  slight: Object.freeze({ direita: t`vire levemente à direita`, esquerda: t`vire levemente à esquerda` }),
  turn: Object.freeze({ direita: t`vire à direita`, esquerda: t`vire à esquerda` }),
  sharp: Object.freeze({ direita: t`vire forte à direita`, esquerda: t`vire forte à esquerda` }),
});
const LEVEL_RANK = Object.freeze({ danger: 0, warn: 1, info: 2 });
const SPEECH = Object.freeze({ lang: HTML_LANG, rate: 1.05, minGapMs: 3500 });

// `glyph`: 'arrow' (seta girada em `turnDeg`), 'stop', 'alert' ou 'home'. `key` muda quando vale falar de novo.
const instruction = (kind, level, text, extra = {}) => ({ kind, level, text, glyph: 'arrow', turnDeg: 0, distM: null, key: kind, ...extra });

function returnAdvice(back) {
  const way = back.via === 'back'
    ? t`Volte pelo caminho da ida: ${fmtDistance(back.distM)} até o habitat, cerca de ${fmtDuration(back.timeH)}.`
    : t`Siga em frente pela rota: ${fmtDistance(back.distM)} até o habitat, cerca de ${fmtDuration(back.timeH)}.`;
  const oxygen = back.o2AfterPct < 0
    ? t`O oxigênio não cobre esse retorno: acione o apoio do habitat.`
    : t`Sobram ${fmtNumber(back.o2AfterPct)}% de O₂ ao chegar.`;
  return `${way} ${oxygen}`;
}

const returnTurnDeg = (back) => (back.via === 'back' ? 180 : 0);

function maneuverPhrase(maneuver) {
  let turn = TURN_PHRASE[maneuver.kind]?.[maneuver.side];
  if (maneuver.kind === 'uturn') turn = maneuver.atStop ? t`retorne pelo caminho de chegada` : t`faça meia-volta`;
  if (Math.abs(maneuver.climbDeg) < GUIDE.climbMinDeg) return turn;
  const climbDeg = fmtNumber(Math.abs(maneuver.climbDeg));
  return maneuver.climbDeg > 0 ? t`${turn} e suba ${climbDeg}°` : t`${turn} e desça ${climbDeg}°`;
}

/**
 * Orientação passo a passo: a próxima curva, ou o trecho reto até ela ou até a parada.
 * Só precisa da análise da rota e do alvo, para poder ser usada por outro visor.
 * @param {object} analysis Resultado de `analyzePlan`.
 * @param {number} distM Distância percorrida na rota.
 * @param {{ kind: 'stop'|'return', distM: number, etaH: number, name: string, stop: { id: string } }} target
 * @param {boolean} onFoot A pé (horizonte de 300 m) ou de veículo (500 m).
 * @returns {{ kind: string, level: string, text: string, glyph: string, turnDeg: number, distM: number|null, key: string }}
 */
export function routeInstruction(analysis, distM, target, onFoot) {
  const maneuver = nextManeuver(analysis, distM);
  const untilM = maneuver ? Math.max(0, maneuver.distM - distM) : Infinity;
  const beforeTarget = maneuver !== null && untilM < target.distM - GUIDE.stopMarginM;
  const horizonM = onFoot ? GUIDE.horizonM.foot : GUIDE.horizonM.cabin;

  if (beforeTarget && untilM <= horizonM) {
    const now = untilM <= GUIDE.nowM;
    let stage = 'far';
    if (now) stage = 'now';
    else if (untilM <= GUIDE.nearM) stage = 'near';
    const text = now ? t`Agora, ${maneuverPhrase(maneuver)}.` : t`Em ${fmtDistance(untilM)}, ${maneuverPhrase(maneuver)}.`;
    return instruction('turn', 'info', text, { turnDeg: maneuver.deltaDeg, distM: untilM, key: `turn:${Math.round(maneuver.distM)}:${stage}` });
  }
  if (beforeTarget) {
    const text = t`Siga em frente por ${fmtDistance(untilM)}. Depois, ${maneuverPhrase(maneuver)}.`;
    return instruction('straight', 'info', text, { distM: untilM, key: `straight:${Math.round(maneuver.distM)}` });
  }
  if (target.kind === 'return') {
    const text = t`Siga ${fmtDistance(target.distM)} de volta ao habitat. Chegada em ${fmtDuration(target.etaH)}.`;
    return instruction('straight', 'info', text, { distM: target.distM, key: 'straight:habitat' });
  }
  const text = t`Siga ${fmtDistance(target.distM)} até ${target.name}. Chegada em ${fmtDuration(target.etaH)}.`;
  return instruction('straight', 'info', text, { distM: target.distM, key: `to-stop:${target.stop.id}`, aboutStop: true });
}

// Uma instrução por vez: vale a regra de maior prioridade que se aplica.
function primaryInstruction(plan, analysis, state, r) {
  const { suit, back, hazard, rejoin, pose, target, terrain } = r;
  if (state.finished) return instruction('done', 'info', t`Travessia concluída. Você está de volta ao habitat.`, { glyph: 'home' });
  if (state.solarEvent) {
    return instruction('solar', 'danger', `${t`Evento solar em curso.`} ${returnAdvice(back)}`, { turnDeg: returnTurnDeg(back), distM: back.distM });
  }
  if (suit.marginH < 0) {
    const text = `${t`O oxigênio não cobre o plano: faltam ${fmtDuration(-suit.marginH)} de autonomia.`} ${returnAdvice(back)}`;
    return instruction('o2-short', 'danger', text, { turnDeg: returnTurnDeg(back), distM: back.distM });
  }
  if (hazard.inside) {
    const text = t`Você está sobre rochas cortantes. Saia no rumo ${fmtBearing(hazard.exitBearingDeg)}: ${fmtDistance(-hazard.edgeM)} até a borda.`;
    return instruction('hazard-in', 'danger', text, { turnDeg: angleDeltaDeg(pose.headingDeg, hazard.exitBearingDeg), distM: -hazard.edgeM });
  }
  if (rejoin) {
    const text = pose.side === 'direita'
      ? t`Fora da rota: ${fmtNumber(pose.offM)} m à direita dela. Vire para ${fmtBearing(rejoin.bearingDeg)} e retome a rota em ${fmtDistance(rejoin.distM)}.`
      : t`Fora da rota: ${fmtNumber(pose.offM)} m à esquerda dela. Vire para ${fmtBearing(rejoin.bearingDeg)} e retome a rota em ${fmtDistance(rejoin.distM)}.`;
    return instruction('off-route', 'warn', text, { turnDeg: angleDeltaDeg(pose.headingDeg, rejoin.bearingDeg), distM: rejoin.distM });
  }
  if (target.kind === 'dwell') {
    const text = t`Parada ${target.stop.id}, ${target.name}. Tarefa: ${target.stop.task}`;
    return instruction('dwell', 'info', text, { glyph: 'stop', key: `dwell:${target.stop.id}` });
  }
  if (terrain.level === 'over') {
    const text = t`Declive de ${fmtNumber(terrain.slopeDeg)}° sob os pés, acima do limite de ${terrain.limitDeg}°. Pare e recue para terreno mais plano.`;
    return instruction('slope-here', 'danger', text, { glyph: 'alert' });
  }
  return routeInstruction(analysis, state.distM, target, r.here.onFoot);
}

function slopeAdvisory(analysis, distM) {
  const steep = nextSteep(analysis, distM);
  if (!steep || steep.fromM - distM > GUIDE.advisoryRangeM) return null;
  const levels = { over: 'danger', near: 'warn', attention: 'info' };
  const isClimb = steep.peakDeg > 0;
  const peakDeg = fmtNumber(Math.abs(steep.peakDeg));
  const inM = Math.max(0, steep.fromM - distM);
  if (inM === 0) {
    const lengthM = fmtDistance(Math.max(STEP_M, steep.toM - distM));
    const text = isClimb ? t`Subida de até ${peakDeg}° pelos próximos ${lengthM}` : t`Descida de até ${peakDeg}° pelos próximos ${lengthM}`;
    return { kind: 'slope', level: levels[steep.level], inM, text };
  }
  const lengthM = fmtDistance(Math.max(STEP_M, steep.toM - steep.fromM));
  const text = isClimb
    ? t`Subida de até ${peakDeg}° em ${fmtDistance(inM)}, por ${lengthM}`
    : t`Descida de até ${peakDeg}° em ${fmtDistance(inM)}, por ${lengthM}`;
  return { kind: 'slope', level: levels[steep.level], inM, text };
}

function hazardAdvisory(analysis, distM, r) {
  const zone = hazardAhead(analysis, distM);
  if (!zone || r.hazard.near || zone.fromM - distM > GUIDE.advisoryRangeM) return null;
  const inM = Math.max(0, zone.fromM - distM);
  const edgeM = fmtDistance(Math.max(0, zone.minEdgeM));
  const text = zone.side === 'direita'
    ? t`Rochas cortantes a ${edgeM} da rota, à direita, em ${fmtDistance(inM)}`
    : t`Rochas cortantes a ${edgeM} da rota, à esquerda, em ${fmtDistance(inM)}`;
  return { kind: 'hazard', level: 'warn', inM, text };
}

function radioAdvisory(r) {
  const { route, changeInH, lossSoon, lossInM, lossLengthM } = r.radio;
  if (lossSoon) {
    return { kind: 'radio', level: 'warn', inM: lossInM, text: t`Rádio: a visada cai em ${fmtDistance(lossInM)}, por ${fmtDistance(lossLengthM)}. Reporte a posição antes` };
  }
  if (route.changeInM === null) return null;
  if (!route.visible) {
    return { kind: 'radio', level: 'info', inM: route.changeInM, text: t`Rádio: sem visada há ${fmtDistance(route.sinceM)}. Volta em ${fmtDistance(route.changeInM)}` };
  }
  const minutes = Math.round(changeInH * 60);
  const when = minutes < 1 ? t`menos de 1 min` : fmtMinutes(minutes);
  const text = t`Rádio: a visada cai em ${fmtDistance(route.changeInM)} (${when}), por ${fmtDistance(route.nextLengthM)}`;
  return { kind: 'radio', level: 'info', inM: route.changeInM, text };
}

// Aviso antes de cruzar o ponto em que o oxigênio deixa de cobrir a volta a pé (plan.safety).
function noReturnAdvisory(r) {
  const { noReturn } = r;
  if (!noReturn || noReturn.passed || noReturn.aheadM > GUIDE.advisoryRangeM) return null;
  const aheadM = fmtDistance(noReturn.aheadM);
  const text = noReturn.noWalkRoute
    ? t`Ponto sem volta a pé em ${aheadM}: dali não há caminho a pé até o habitat`
    : t`Ponto sem volta a pé em ${aheadM}: depois dele o O₂ não cobre voltar andando com a reserva`;
  return { kind: 'no-return', level: 'warn', inM: noReturn.aheadM, text };
}

function advisoriesFor(analysis, state, r, primary) {
  const { target, pace } = r;
  const list = [slopeAdvisory(analysis, state.distM), hazardAdvisory(analysis, state.distM, r), radioAdvisory(r), noReturnAdvisory(r)];
  // A parada só entra aqui quando a instrução principal está falando de outra coisa.
  if (target.kind === 'stop' && !primary.aboutStop) {
    list.push({ kind: 'stop', level: 'info', inM: target.distM, text: t`Parada ${target.stop.id} · ${target.name} em ${fmtDistance(target.distM)}` });
  }
  if (Math.abs(pace.deltaMin) >= NAV.paceOnPlanMin) {
    const text = pace.deltaMin > 0
      ? t`Ritmo: adiantado ${fmtMinutes(pace.deltaMin)} em relação ao plano`
      : t`Ritmo: atrasado ${fmtMinutes(-pace.deltaMin)} em relação ao plano`;
    list.push({ kind: 'pace', level: pace.level === 'warn' ? 'warn' : 'info', inM: Infinity, text });
  }
  return list
    .filter(Boolean)
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.inM - b.inM)
    .slice(0, GUIDE.maxAdvisories);
}

/**
 * @param {object} plan
 * @param {object} analysis Resultado de `analyzePlan`.
 * @param {object} state Estado de `sim.js`.
 * @param {object} readout Resultado de `deriveReadout`.
 */
export function buildGuidance(plan, analysis, state, readout) {
  const primary = primaryInstruction(plan, analysis, state, readout);
  const advisories = state.finished ? [] : advisoriesFor(analysis, state, readout, primary);
  return { primary, advisories };
}

// O sintetizador lê mal "O₂", o separador "·" e durações como "1h41".
const spokenText = (text) => text
  .replaceAll('O₂', t`oxigênio`)
  .replaceAll(' · ', ', ')
  .replace(/(\d+)h(\d{2})/g, (_, hours, minutes) => t`${Number(hours)} h e ${Number(minutes)} min`);

/** Voz do assistente pelo sintetizador do navegador. Começa desligada. */
export function createSpeaker() {
  const synth = globalThis.speechSynthesis ?? null;
  const supported = Boolean(synth) && typeof globalThis.SpeechSynthesisUtterance === 'function';
  let enabled = false;
  let lastKey = '';
  let lastAtMs = -Infinity;

  function setEnabled(on) {
    enabled = on && supported;
    lastKey = '';
    if (!enabled && supported) synth.cancel();
    return enabled;
  }

  // Fala quando a chave muda. Fala urgente passa na frente; as outras esperam um intervalo mínimo.
  function say(key, text, urgent = false) {
    if (!enabled || key === lastKey) return;
    const nowMs = performance.now();
    if (!urgent && nowMs - lastAtMs < SPEECH.minGapMs) return;
    lastKey = key;
    lastAtMs = nowMs;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText(text));
    utterance.lang = SPEECH.lang;
    utterance.rate = SPEECH.rate;
    synth.speak(utterance);
  }

  return Object.freeze({ supported, setEnabled, say });
}
