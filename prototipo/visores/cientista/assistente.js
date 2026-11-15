// Assistente de campo: uma função única, askAssistant(pergunta, contexto), com um motor
// de intenções por regras atrás dela. NÃO é um modelo de linguagem: cada resposta é
// montada com os dados do contexto (simulação, textos das paradas, diário, perigos).
// Perguntas devolvem texto; comandos devolvem uma ação que o visor executa e relata.
// Para ligar um modelo real depois, passe outro motor a askAssistant (ver NOTAS.md).
//
// Lógica pura: não toca no DOM e roda no Node. Tudo o que o assistente sabe chega pelo
// parâmetro `context`; quem hospeda (este visor ou outro) monta esse objeto. O formato:
//
/**
 * @typedef {object} AssistantContext
 * @property {'walk'|'car'} mode
 * @property {boolean} finished
 * @property {number} stopsReached Quantas paradas do plano já foram alcançadas.
 * @property {number} elapsedH Tempo de saída, em horas.
 * @property {number} clockH Hora local, em horas decimais.
 * @property {{ distM: number, elevM: number, onFoot: boolean, lat: number, lon: number }} position
 * @property {{ kind: 'stop'|'dwell'|'return', stopId: string, name: string, distM: number, etaH: number, gainM: number }} target
 * @property {boolean} atStop Em coleta numa parada.
 * @property {object} focusStop Parada em coleta ou a próxima (item de `stops`).
 * @property {Array<object>} stops Paradas no formato de data/travessia.js, mais `order` (-1 fora do plano), `inPlan` e `distM`.
 * @property {{ stopCount: number, totalKm: number, hours: number, blockedLegs: string[] }} plan
 * @property {{ o2Pct: number, batteryPct: number, batteryEndPct: number, marginH: number, planEndO2Pct: number, hoursToFinish: number, leaking: boolean }} suit
 * @property {{ slopeDeg: number, slopeAheadDeg: number, radiationUsvH: number, doseUsv: number, airTempC: number }} env
 * @property {{ direction: 'back'|'forward', distM: number, etaH: number, walkH: number|null, o2UsePct: number, o2ArrivalPct: number }} habitat
 * @property {{ failed: boolean, lineOfSight: boolean|null, backInM: number|null }} comms
 * @property {{ distM: number, aheadM: number }|null} noReturn Ponto sem volta a pé do plano.
 * @property {{ terrain: { distM: number, walkH: number, skyBlocked: number }|null }|null} shelter
 * @property {{ o2ReservePct: number, habitatMastM: number, suitAntennaM: number }} assumptions
 * @property {{ edgeM: number, side: string, near: boolean }} riskZone Zona de rochas cortantes dos dados.
 * @property {{ storm: boolean, solar: boolean, radio: boolean, o2: boolean }} emergencies
 * @property {{ id: string, step: number }|null} protocol Protocolo em condução.
 * @property {Record<string, { title: string, steps: string[], evidence: Array<{ text: string, label: string }> }>} protocols
 * @property {{ total: number, nearest: object|null, list: object[] }} hazards Perigos relatados (ver perigos.js).
 * @property {{ entries: number, samples: number, hazardReports: number, lastSample: string }} journal Resumo do diário (ver diario.js).
 * @property {Array<{ kind: string, level: 'critico'|'atencao'|'info', text: string, action: string }>} alerts
 */

import { SIM } from '../../src/simulation.js';
import { fmtDistance, fmtDuration, fmtNumber, fmtClock, fmtSigned, fmtKm } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { homeLine, habitatLine, pct, stopShortName, LIMITS } from './contexto.js';
import { EMERGENCIES, protocolStepText, protocolEvidenceText, shelterLine } from './protocolos.js';

const PLAN_TEXT = Object.freeze({ walk: t`Plano a pé`, car: t`Plano de veículo` });
// As regras leem a pergunta em português e em inglês, seja qual for o idioma da interface:
// em cada padrão, as palavras em inglês vêm depois das em português.
// Palavras que identificam cada parada numa pergunta (sem acento, como no texto normalizado).
const STOP_WORDS = Object.freeze({
  H: ['habitat', 'argila', 'clay'],
  1: ['greenheugh', 'pediment', 'arenito', 'sandstone'],
  2: ['crista', 'detrito', 'ridge', 'debris'],
  3: ['enxofre', 'canal', 'sulfur', 'sulphur', 'channel'],
  4: ['boxwork'],
  5: ['sulfato', 'sulfate', 'sulphate'],
  D: ['destino', 'destination'],
});
const EMERGENCY_WORDS = Object.freeze({
  storm: /tempestade|poeira|\bstorm\b|\bdust\b/,
  solar: /solar|radiacao|radiation/,
  radio: /radio|comunicacao|contato|\bcomms\b|\bcommunications?\b|\bcontact\b/,
  o2: /oxigenio|o2|oxygen/,
});
const NEXT_STOP_WORDS = /\bproxima\b|\bnext (stop|one|site)\b|\bwhat (is|s) next\b/;
const HABITAT_WORDS = /\b(habitat|base|walk back|way back)\b/;
const UNKNOWN_TEXT = t`Não sei responder a isso. Só tenho os dados desta saída: rota, traje, ambiente, paradas, diário e perigos relatados. Tente, por exemplo, “quanto falta?” ou “é seguro continuar?”.`;

/** Minúsculas, sem acento e sem pontuação: a forma em que as regras leem a pergunta. */
export const normalize = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/₂/g, '2')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Contagens com a palavra no singular ou no plural: cada uma é uma frase inteira, para a tradução.
const samplesText = (count) => (count === 1 ? t`1 amostra` : t`${count} amostras`);
const hazardReportsText = (count) => (count === 1 ? t`1 relato de perigo` : t`${count} relatos de perigo`);
const entriesText = (count) => (count === 1 ? t`1 registro` : t`${count} registros`);
const stopsText = (count) => (count === 1 ? t`1 parada` : t`${count} paradas`);

const isHabitat = (stop) => stop.id === 'H';
const nextPlannedStop = (context) => context.stops.find((stop) => stop.order === context.stopsReached) ?? null;

function mentionedStop(norm, context) {
  const byNumber = norm.match(/\b(?:parada|stop) (\d|h|d)\b/);
  if (byNumber) return context.stops.find((stop) => stop.id.toLowerCase() === byNumber[1]) ?? null;
  if (NEXT_STOP_WORDS.test(norm)) return nextPlannedStop(context);
  // Começo de palavra: "ridge" não pode casar dentro de "bridge".
  return context.stops.find((stop) => STOP_WORDS[stop.id]?.some((word) => new RegExp(`\\b${word}`).test(norm))) ?? null;
}

const pickStop = (norm, context) => mentionedStop(norm, context) ?? context.focusStop;

// Onde a parada está em relação à saída: já vem com o espaço que a separa da frase anterior.
function stopStatus(context, stop) {
  if (context.atStop && stop.id === context.focusStop.id) return ` ${t`Você está nela agora.`}`;
  if (isHabitat(stop)) return '';
  if (!stop.inPlan) return ` ${t`Essa parada não faz parte do plano desta saída.`}`;
  if (stop.order < context.stopsReached) return ` ${t`Essa parada já foi visitada nesta saída.`}`;
  return ` ${t`Faltam ${fmtDistance(stop.distM - context.position.distM)} de rota até lá.`}`;
}

function replyHowFar(context, { norm }) {
  if (context.finished) return t`A travessia terminou: você está de volta ao habitat.`;
  if (HABITAT_WORDS.test(norm)) {
    const away = context.habitat.distM >= LIMITS.atHabitatM && context.habitat.walkH !== null;
    return `${habitatLine(context)}.${away ? ` ${t`A pé pelo relevo: ${fmtDuration(context.habitat.walkH)}.`}` : ''}`;
  }
  const { target } = context;
  const rest = t`Para fechar o plano inteiro faltam ${fmtDuration(context.suit.hoursToFinish)}.`;
  if (target.kind === 'return') return t`As coletas terminaram. Faltam ${fmtDistance(target.distM)} até o habitat, chegada em ${fmtDuration(target.etaH)}.`;
  if (target.kind === 'dwell') {
    const next = nextPlannedStop(context);
    const after = next
      ? t`Depois, são ${fmtDistance(next.distM - context.position.distM)} até a parada ${next.id}, ${stopShortName(next)}.`
      : t`Depois dela começa o retorno ao habitat.`;
    return `${t`Você está em coleta na parada ${target.stopId}, ${target.name}.`} ${after} ${rest}`;
  }
  const toStop = t`Faltam ${fmtDistance(target.distM)} até a parada ${target.stopId}, ${target.name}: cerca de ${fmtDuration(target.etaH)}, com ${fmtSigned(target.gainM)} m de desnível.`;
  return `${toStop} ${habitatLine(context)}. ${rest}`;
}

function replySafety(context) {
  if (context.finished) return t`A saída terminou: você está no habitat.`;
  const critical = context.alerts.filter((alert) => alert.level === 'critico');
  const warnings = context.alerts.filter((alert) => alert.level === 'atencao');
  const suit = t`O₂ em ${pct(context.suit.o2Pct)}, margem de ${fmtDuration(context.suit.marginH)} ao fim do plano, bateria em ${pct(context.suit.batteryPct)}.`;
  if (critical.length) return `${t`Não é seguro continuar.`} ${critical.map((alert) => alert.text).join('. ')}. ${critical[0].action}`;
  if (warnings.length) return `${t`Dá para continuar, com atenção: ${warnings.map((alert) => alert.text).join('; ')}.`} ${warnings[0].action} ${suit}`;
  return `${t`Sim, é seguro continuar: nenhum alerta ativo.`} ${suit} ${habitatLine(context)}.`;
}

function replyOxygen(context) {
  const { suit, habitat } = context;
  const sentences = [t`O₂ em ${pct(suit.o2Pct)} (telemetria simulada).`];
  if (habitat.distM >= LIMITS.atHabitatM) {
    const way = habitat.walkH !== null ? t`a pé pelo relevo, ${fmtDuration(habitat.walkH)}` : homeLine(context);
    const use = pct(habitat.o2UsePct);
    sentences.push(habitat.o2ArrivalPct >= 0
      ? t`Se voltar agora (${way}), gasta cerca de ${use} e chega ao habitat com ${pct(habitat.o2ArrivalPct)}.`
      : t`Se voltar agora (${way}), gasta cerca de ${use} e o O₂ acaba antes de chegar.`);
  }
  sentences.push(suit.marginH >= 0
    ? t`Seguindo o plano até o fim, sobram ${pct(suit.planEndO2Pct)}, uma margem de ${fmtDuration(suit.marginH)}.`
    : t`O plano inteiro não fecha: faltam ${fmtDuration(-suit.marginH)} de autonomia.`);
  if (suit.leaking) sentences.push(t`Há um vazamento simulado em curso.`);
  return sentences.join(' ');
}

function replyBattery({ suit }) {
  return suit.batteryEndPct >= 0
    ? t`Bateria do traje em ${pct(suit.batteryPct)} (simulada). No ritmo do plano, termina a saída com cerca de ${pct(suit.batteryEndPct)}.`
    : t`Bateria do traje em ${pct(suit.batteryPct)} (simulada). No ritmo do plano, ela acaba antes do fim do plano.`;
}

function replyShelter(context) {
  const cabin = context.position.onFoot ? '' : ` ${t`Você está na cabine do veículo agora.`}`;
  return `${shelterLine(context)}${cabin}`;
}

function replyComms({ comms, assumptions }) {
  if (comms.failed) return t`Falha de rádio com o habitat (simulada). O visor segue funcionando: rota, relevo, diário e perigos relatados estão guardados aqui.`;
  if (comms.lineOfSight === null) return t`Não tenho a análise de linha de visada para este plano, então não sei dizer se há rádio direto com o habitat.`;
  const basis = t`A conta usa o relevo real e alturas de antena que são hipótese da equipe (mastro de ${assumptions.habitatMastM} m no habitat, ${assumptions.suitAntennaM} m no traje).`;
  if (comms.lineOfSight) return `${t`Há linha de visada de rádio com o mastro do habitat.`} ${basis}`;
  return `${t`Sem linha de visada com o mastro do habitat: o relevo tapa o sinal direto. Seguindo a rota, a visada volta em ${fmtDistance(comms.backInM)}.`} ${basis}`;
}

function replyNoReturn(context) {
  const reservePct = pct(context.assumptions.o2ReservePct);
  const now = context.habitat.walkH !== null
    ? ` ${t`Agora, a volta a pé pelo relevo leva ${fmtDuration(context.habitat.walkH)} e você chegaria com ${pct(context.habitat.o2ArrivalPct)} de O₂.`}`
    : '';
  if (!context.noReturn) return `${t`Este plano não tem ponto sem volta a pé: em toda a rota o O₂ previsto cobre a caminhada até o habitat com a reserva de ${reservePct} (hipótese da equipe).`}${now}`;
  const { aheadM } = context.noReturn;
  const where = aheadM > 0
    ? t`O ponto sem volta a pé deste plano fica ${fmtDistance(aheadM)} à frente na rota.`
    : t`O ponto sem volta a pé deste plano ficou ${fmtDistance(-aheadM)} para trás na rota.`;
  return `${where} ${t`Depois dele, o O₂ previsto não cobre a caminhada até o habitat com a reserva de ${reservePct} (hipótese da equipe).`}${now}`;
}

function replySources(context, { norm }) {
  const aboutProtocol = /\b(protocolo|passos?|disso|isso|desse|deste|protocol|steps?|(this|that) (step|protocol))\b/.test(norm);
  const asked = aboutProtocol ? Object.keys(EMERGENCY_WORDS).find((id) => EMERGENCY_WORDS[id].test(norm)) ?? context.protocol?.id : null;
  if (asked && context.protocols?.[asked]) return t`Base do protocolo de ${EMERGENCIES[asked].label.toLowerCase()}, que é proposta da equipe: ${protocolEvidenceText(asked, context)}`;
  return t`Reais: relevo, declive, altitude e rotas (MSL Gale Merged DEM, USGS Astrogeology / JPL-Caltech / NASA), a linha de visada de rádio calculada sobre esse relevo, a taxa de radiação (média medida pelo RAD do Curiosity) e a faixa de temperatura (REMS do Curiosity). Estimada: a temperatura de cada hora, entre os extremos medidos. Simulados: traje, vento e emergências. Os textos das paradas são o roteiro da equipe. Os protocolos são propostas da equipe, cada um com fatos de missão e fonte: pergunte, por exemplo, “qual a fonte do protocolo de evento solar?”.`;
}

function replyRadiation({ env, emergencies }) {
  const solar = emergencies.solar ? ` ${t`Há um evento solar simulado em curso: a taxa está ${SIM.solarEventFactor}× acima do normal. Vá para o habitat.`}` : '';
  return `${t`Taxa de ${fmtNumber(env.radiationUsvH)} µSv/h e dose acumulada de ${fmtNumber(env.doseUsv)} µSv nesta saída. A taxa é a média medida pelo RAD do Curiosity em Gale; a dose da saída é essa taxa vezes o tempo, não uma medição.`}${solar}`;
}

const riskZoneLine = (riskZone) => t`A zona de rochas cortantes dos dados, de posição aproximada, fica a ${fmtDistance(riskZone.edgeM)} ${riskZone.side}.`;

function replyTerrain({ env, riskZone }) {
  const here = fmtSigned(env.slopeDeg);
  const ahead = fmtNumber(env.slopeAheadDeg);
  const slope = env.slopeAheadDeg >= SIM.slopeWarnDeg
    ? t`Declive de ${here}° onde você está; nos próximos ${SIM.slopeLookaheadM} m chega a ${ahead}°, acima do limite de atenção de ${SIM.slopeWarnDeg}°.`
    : t`Declive de ${here}° onde você está; nos próximos ${SIM.slopeLookaheadM} m chega a ${ahead}°.`;
  return `${slope} ${t`O declive vem do relevo real (DEM do USGS).`} ${riskZoneLine(riskZone)}`;
}

function replyAltitude({ position, target }) {
  const gain = target.kind === 'dwell' ? '' : ` ${t`O próximo destino (${target.name}) fica ${fmtSigned(target.gainM)} m em relação a você.`}`;
  return `${t`Você está a ${fmtNumber(position.elevM)} m de altitude, pelo relevo real do USGS.`}${gain}`;
}

// O perigo relatado mais próximo: com ou sem nota, desta saída ou de uma anterior.
function nearestHazardLine(nearest) {
  const what = nearest.label.toLowerCase();
  const distance = fmtDistance(nearest.distM);
  if (nearest.note) {
    return nearest.previous
      ? t`O mais próximo: ${what} a ${distance} ${nearest.side}, com a nota “${nearest.note}”, de uma saída anterior.`
      : t`O mais próximo: ${what} a ${distance} ${nearest.side}, com a nota “${nearest.note}”, relatado nesta saída.`;
  }
  return nearest.previous
    ? t`O mais próximo: ${what} a ${distance} ${nearest.side}, de uma saída anterior.`
    : t`O mais próximo: ${what} a ${distance} ${nearest.side}, relatado nesta saída.`;
}

function replyHazards({ hazards, riskZone }) {
  const zone = riskZoneLine(riskZone);
  if (!hazards.total) return `${t`Nenhum perigo relatado por astronautas até agora.`} ${zone} ${t`Para relatar, toque em “Relatar perigo” ou diga “relatar perigo areia fofa”.`}`;
  const stored = hazards.total === 1 ? t`Há 1 perigo relatado guardado.` : t`Há ${hazards.total} perigos relatados guardados.`;
  return `${stored} ${nearestHazardLine(hazards.nearest)} ${zone}`;
}

function replyJournal({ journal }) {
  const sentences = [t`O diário tem ${samplesText(journal.samples)}, ${hazardReportsText(journal.hazardReports)} e ${entriesText(journal.entries)} no total.`];
  if (journal.lastSample) sentences.push(t`Última amostra: “${journal.lastSample}”.`);
  sentences.push(t`Abra a aba Diário para rever ou exportar.`);
  return sentences.join(' ');
}

function replyRoute(context) {
  const planned = context.stops.filter((stop) => stop.order >= 0);
  const done = planned.filter((stop) => stop.order < context.stopsReached).map((stop) => stop.id);
  const todo = planned.filter((stop) => stop.order >= context.stopsReached).map((stop) => `${stop.id} (${stopShortName(stop)})`);
  const sentences = [
    t`${PLAN_TEXT[context.mode]} com ${stopsText(context.plan.stopCount)}, ${fmtKm(context.plan.totalKm)} e cerca de ${fmtDuration(context.plan.hours)} no total.`,
    t`Visitadas: ${done.join(', ') || t`nenhuma`}.`,
    t`Faltam: ${todo.join(', ') || t`nenhuma, só o retorno ao habitat`}.`,
  ];
  if (context.plan.blockedLegs.length) sentences.push(t`Trechos sem passagem para o veículo, feitos a pé: ${context.plan.blockedLegs.join(', ')}.`);
  return sentences.join(' ');
}

function replyStatus(context) {
  const { target, suit, alerts, journal } = context;
  const elapsed = fmtDuration(context.elapsedH);
  let where = t`Resumo: ${elapsed} de saída, ${fmtDistance(target.distM)} até ${target.name}.`;
  if (context.finished) where = t`Resumo: ${elapsed} de saída, saída concluída.`;
  else if (target.kind === 'dwell') where = t`Resumo: ${elapsed} de saída, em coleta na parada ${target.stopId}.`;
  const alertText = alerts.length ? t`Alertas: ${alerts.map((alert) => alert.text).join('; ')}.` : t`Nenhum alerta ativo.`;
  return `${where} ${t`O₂ em ${pct(suit.o2Pct)}, bateria em ${pct(suit.batteryPct)}, margem de ${fmtDuration(suit.marginH)}.`} ${alertText} ${t`Diário com ${samplesText(journal.samples)}.`}`;
}

function replyProtocolInfo(context, { norm }) {
  const asked = Object.keys(EMERGENCY_WORDS).find((id) => EMERGENCY_WORDS[id].test(norm));
  if (context.protocol && context.protocols?.[context.protocol.id] && (!asked || asked === context.protocol.id)) {
    return `${t`Protocolo de ${EMERGENCIES[context.protocol.id].label.toLowerCase()} em andamento.`} ${protocolStepText(context.protocol, context)}`;
  }
  if (asked && context.protocols?.[asked]) {
    const steps = context.protocols[asked].steps.map((step, index) => `${index + 1}) ${step}`).join(' ');
    return `${t`Protocolo para ${EMERGENCIES[asked].label.toLowerCase()}, proposta da equipe: ${steps}`} ${EMERGENCIES[asked].live(context)}`;
  }
  return t`Nenhuma emergência em andamento. Conduzo quatro protocolos propostos pela equipe: tempestade de poeira, evento solar, perda de rádio e oxigênio baixo. Pergunte, por exemplo, “o que fazer numa tempestade de poeira?”.`;
}

function replyWhy(context, stop) {
  const name = stopShortName(stop);
  if (!stop.imp) {
    const lead = isHabitat(stop)
      ? t`O habitat, é um ponto escolhido no mapa pela tripulação.`
      : t`A parada ${stop.id}, ${name}, é um ponto escolhido no mapa pela tripulação.`;
    return `${lead} ${t`Não tenho, nos dados, um texto sobre a importância científica desse ponto. O que há: ${stop.sci}`}`;
  }
  const lead = isHabitat(stop)
    ? t`O habitat é o capítulo “${stop.ch}” da linha do tempo.`
    : t`A parada ${stop.id}, ${name}, é o capítulo “${stop.ch}” da linha do tempo.`;
  return `${lead} ${stop.imp} ${stop.int ?? ''}`.trim();
}

function replyQuestion(context, stop) {
  const objective = isHabitat(stop) ? t`Objetivo no habitat: ${stop.sci}` : t`Objetivo na parada ${stop.id}, ${stopShortName(stop)}: ${stop.sci}`;
  return `${objective} ${t`Pergunta científica: ${stop.q}`}`;
}

// Já vem com o espaço que a separa da frase anterior.
const riskText = (stop) => (stop.risk ? ` ${t`Risco anotado no roteiro: ${stop.risk}.`}` : '');

function taskLine(stop, here) {
  if (isHabitat(stop)) return here ? t`Tarefa aqui no habitat: ${stop.task}` : t`Tarefa no habitat: ${stop.task}`;
  const name = stopShortName(stop);
  return here ? t`Tarefa aqui na parada ${stop.id}, ${name}: ${stop.task}` : t`Tarefa na parada ${stop.id}, ${name}: ${stop.task}`;
}

function replyTask(context, stop) {
  const here = context.atStop && stop.id === context.focusStop.id;
  const tail = here ? ` ${t`Quando terminar, registre a amostra no diário.`}` : stopStatus(context, stop);
  return `${taskLine(stop, here)}${riskText(stop)}${tail}`;
}

function replyObserve(context, stop) {
  const lead = isHabitat(stop)
    ? t`Sugestão montada só com o roteiro do habitat.`
    : t`Sugestão montada só com o roteiro da parada ${stop.id}, ${stopShortName(stop)}.`;
  const lookFor = stop.int ? `${stop.sci} ${stop.int}` : stop.sci;
  return `${lead} ${t`O que fazer: ${stop.task}`} ${t`O que procurar: ${lookFor}`}${riskText(stop)} ${t`Não tenho dados além do roteiro para sugerir mais do que isso.`}`;
}

function replyStopSummary(context, stop) {
  const lead = isHabitat(stop)
    ? t`O habitat, capítulo “${stop.ch}”.`
    : t`A parada ${stop.id}, ${stopShortName(stop)}, capítulo “${stop.ch}”.`;
  return `${lead} ${stop.sci} ${t`Pergunta científica: ${stop.q}`} ${t`Tarefa: ${stop.task}`}${riskText(stop)}${stopStatus(context, stop)}`;
}

function replyVehicle(context) {
  const now = context.position.onFoot ? t`Agora você está a pé.` : t`Agora você está na cabine do veículo.`;
  const blocked = context.plan.blockedLegs.length ? ` ${t`Trechos sem passagem para o veículo: ${context.plan.blockedLegs.join(', ')}.`}` : '';
  return `${PLAN_TEXT[context.mode]}. ${now}${blocked}`;
}

// Comando é ordem direta: verbo no começo e sem interrogação. Uma pergunta ("há algum relato
// de perigo perto?") nunca pode gravar um perigo, registrar amostra ou encerrar emergência.
const isOrder = (raw) => !raw.trim().endsWith('?');
const HAZARD_ORDER = new RegExp([
  '^(relatar?|relate|marcar?|marque|sinalizar?|sinalize|reportar?|reporte|registrar?|registre)\\b.*\\b(perigo|rocha|pedra|areia|declive|buraco|obstaculo)\\b',
  '^perigo (de |com |em )?(rocha|pedra|areia|declive|buraco|outro)\\b',
  // Em inglês, "log" e "record" também registram amostra: só viram relato com a palavra "hazard" ou "danger".
  // "Report" sem essas palavras só vale com o perigo logo depois do verbo ("report sharp rocks ahead"):
  // "report on the slope ahead" é um pedido de informação e não pode gravar um relato.
  '^(report|flag|mark|log|record)\\b.*\\b(hazard|danger)\\b',
  '^(report|flag|mark) (?!(on|about|for|to|me)\\b)(an? |the |some )?(\\w+ )?(rocks?|stones?|sand|slope|hole|pit|obstacle)( ahead| here| nearby| (on|to) the (left|right))?( *:.*)?$',
  '^hazard (of |with |in |on )?(sharp |soft )?(rocks?|stones?|sand|slope|hole|other)\\b',
].join('|'));
const SAMPLE_ORDER = /^(registrar?|registre|anotar?|anote|gravar?|grave|salvar?|salve)\b.*\b(amostra|observacao|coleta)\b|^(log|record|register|save|add)\b.*\b(sample|observation)\b/;
const END_ORDER = /^(encerrar?|encerre|cancelar?|cancele|terminar?|termine)\b.*\b(emergencia|protocolo)\b|^fim d[ao] (emergencia|protocolo)\b|^(end|stop|cancel|finish|terminate|close)\b.*\b(emergency|protocol)\b/;
// Palavras do comando, na grafia original, para sobrar só a nota de quem falou.
const HAZARD_WORDS = /^\s*\S+\s+((um|uma|o|a|an|the)\s+)?((perigo|hazard|danger)\s*)?((de|com|em|of|with|in|on)\s+)?((outro|other)\s*)?/i;
const SAMPLE_WORDS = /^\s*\S+\s+((uma|a|esta|essa|the|this|that)\s+)?(amostra|observa[cç][aã]o|coleta|sample|observation)\s*/i;

// Nota: o que vem depois dos dois-pontos ou, sem eles, depois das palavras do comando.
function noteOf(raw, commandWords) {
  const note = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw.replace(commandWords, '')).trim();
  return /[\p{L}\p{N}]/u.test(note) ? note : '';
}

function hazardCommand(context, { raw, norm }) {
  let hazardType = 'outro';
  // As palavras em inglês valem inteiras: "sand" não pode casar dentro de "thousand".
  if (/rocha|cortante|pedra|\b(rocks?|sharp|stones?)\b/.test(norm)) hazardType = 'rocha';
  else if (/areia|fofa|\b(sand|soft)\b/.test(norm)) hazardType = 'areia';
  else if (/declive|inclin|ingreme|barranco|ladeira|\b(slope|steep|cliff)\b/.test(norm)) hazardType = 'declive';
  const note = raw.includes(':') || hazardType === 'outro' ? noteOf(raw, HAZARD_WORDS) : '';
  return { action: { type: 'report-hazard', hazardType, note } };
}

const sampleCommand = (context, { raw }) => ({ action: { type: 'record-sample', note: noteOf(raw, SAMPLE_WORDS) } });

const forStop = (reply) => (context, question) => {
  if (NEXT_STOP_WORDS.test(question.norm) && !nextPlannedStop(context)) return t`Não há próxima parada: as coletas do plano terminaram e o destino agora é o habitat.`;
  return reply(context, pickStop(question.norm, context));
};
const inProtocol = (context) => Boolean(context.protocol);
const asksWhatToDo = (norm) => /\b(o que (eu )?(faco|fazer|devo fazer)|como agir|e se|what (do|should|must) i do|what to do|how (do|should) i (act|react)|what if)\b/.test(norm);

// A primeira regra que casa responde: as mais específicas vêm antes.
const INTENTS = Object.freeze([
  { id: 'protocolo-avancar', when: inProtocol, match: /^(feito|pronto|ok|okay|certo|confirmo|confirmado|concluido|sim|proximo( passo)?|passo seguinte|seguinte|pode seguir|ja fiz|entendido|done|step done|ready|yes|confirmed?|completed?|next( step)?|go on|got it|roger|copy|understood)$/, reply: () => ({ action: { type: 'protocol-advance' } }) },
  { id: 'protocolo-repetir', when: inProtocol, match: /\b(repet\w*|de novo|qual (e )?o passo|passo atual|repeat\w*|again|(which|what) step|current step)\b/, reply: (context) => protocolStepText(context.protocol, context) },
  { id: 'protocolo-encerrar', match: (norm, context, raw) => isOrder(raw) && END_ORDER.test(norm), reply: () => ({ action: { type: 'protocol-end' } }) },
  { id: 'relatar-perigo', match: (norm, context, raw) => isOrder(raw) && HAZARD_ORDER.test(norm), reply: hazardCommand },
  { id: 'registrar-amostra', match: (norm, context, raw) => isOrder(raw) && SAMPLE_ORDER.test(norm) && !/\b(perigo|hazard)\b/.test(norm), reply: sampleCommand },
  { id: 'pausar', match: /^(pausar?|pausa|pare|parar|pause|stop|hold)( a simulacao| the simulation)?$/, reply: () => ({ action: { type: 'pause' } }) },
  { id: 'continuar', match: /^(continuar?|retomar?|seguir|segue|vamos|continue|resume|unpause|proceed|carry on|go|let s go)( a simulacao| the simulation)?$/, reply: () => ({ action: { type: 'resume' } }) },
  { id: 'identidade', match: /\b(quem e voce|voce e (uma? )?(ia|robo|inteligencia|humano|pessoa|modelo)|como voce funciona|chatgpt|claude|llm|who are you|what are you|are you (an? )?(ai|robot|bot|human|person|model)|how do you work)\b/, reply: () => t`Sou um assistente simulado por regras, sem modelo de linguagem por trás. Reconheço a intenção da pergunta e respondo só com os dados desta saída. Quando não tenho o dado, eu digo que não sei.` },
  { id: 'saudacao', match: /^(oi|ola|bom dia|boa tarde|boa noite|e ai|alo|hi|hello|hey|good (morning|afternoon|evening))\b/, reply: () => t`Olá. Estou acompanhando a saída. Pergunte sobre rota, segurança, traje ou a ciência das paradas, ou peça para relatar um perigo.` },
  { id: 'agradecimento', match: /\b(obrigad[oa]|valeu|agradeco|thanks?|thank you|cheers)\b/, reply: () => t`De nada. Sigo acompanhando.` },
  { id: 'ajuda', match: /\b(ajuda|o que voce (sabe|pode|consegue)|como (te |lhe )?us(o|ar)|comandos|o que posso perguntar|help|what can you (do|answer)|what do you know|how do i use|commands|what can i ask)\b/, reply: () => t`Respondo sobre: quanto falta, se é seguro continuar, oxigênio e bateria, abrigo, radiação, temperatura, declive, altitude, a ciência de cada parada, o diário e os perigos relatados. Comandos: “relatar perigo areia fofa”, “registrar amostra: observação”, “pausar”, “continuar” e, em emergência, “feito” para o próximo passo.` },
  { id: 'previsao', match: /\b(previsao|amanha|vai (ter|chover|ventar)|quando (vai|vem)|forecast|tomorrow|(is it going to|will it|will there be) (\w+ ){0,2}(rain|storm|wind|windy|dust|cold|hot|weather))\b/, reply: () => t`Não sei. Os dados desta saída não trazem previsão de clima nem de clima espacial, só o que acontece agora na simulação.` },
  { id: 'fonte', match: /\b(fontes?|evidencias?|referencias?|de onde vem|de onde vieram|baseado em que|e real|sao reais|sources?|evidence|references?|where (does|do|did) (it|that|this|they|these|those) come from|based on what|(is|are) (\w+ ){0,4}real)\b/, reply: replySources },
  { id: 'sem-volta', match: /\b(sem (volta|retorno)|ate onde (posso|da para|consigo) ir|no return|point of no|how far can i go)\b/, reply: replyNoReturn },
  { id: 'protocolo', match: (norm) => /\b(protocolo|procedimento|emergencia|protocols?|procedures?|emergency|emergencies)\b/.test(norm) || (asksWhatToDo(norm) && Object.values(EMERGENCY_WORDS).some((words) => words.test(norm))), reply: replyProtocolInfo },
  { id: 'oxigenio', match: /\b(oxigenio|o2|respir\w*|autonomia|oxygen|breath\w*|air supply|endurance)\b/, reply: replyOxygen },
  { id: 'bateria', match: /\b(bateria|energia|carga|battery|power|charge)\b/, reply: replyBattery },
  { id: 'abrigo', match: /\b(abrigo|abrigar|refugio|proteger|onde (fica|esta) o habitat|(voltar|retornar|retorno) (para|pro|ao|a) (o )?(habitat|base)|shelter|refuge|take cover|where is the habitat|(go|get|head|walk|return) back to (the )?(habitat|base)|return to (the )?(habitat|base))\b/, reply: replyShelter },
  { id: 'radiacao', match: /\b(radiacao|dose|solar|sievert|clima espacial|radiation|space weather)\b/, reply: replyRadiation },
  { id: 'temperatura', match: /\b(temperatura|frio|quente|calor|temperature|cold|hot|warm|heat)\b/, reply: ({ env }) => t`Temperatura do ar em ${fmtNumber(env.airTempC)} °C. É uma estimativa para esta hora, entre a mínima e a máxima medidas pelo REMS do Curiosity; não é medição direta.` },
  { id: 'comunicacao', match: /\b(radio|comunicacao|sinal|visada|comms|communications?|signal|line of sight)\b/, reply: replyComms },
  { id: 'seguranca', match: /\b(seguro|segura|seguranca|posso (continuar|seguir|prosseguir)|devo (continuar|voltar|parar)|algum (risco|alerta)|alertas?|safe|safety|can i (continue|go on|keep going|proceed)|should i (continue|go on|keep going|turn back|go back|stop)|any (risks?|alerts?)|alerts?)\b/, reply: replySafety },
  { id: 'importancia', match: /\b(por que|porque|pra que|para que|importa\w*|importancia|relevan\w*|vale a pena|why|what for|matters?|worth)\b/, reply: forStop(replyWhy) },
  { id: 'observar', match: /\b(observ\w*|olhar|reparar|procurar|sugest\w*|sugere|dica|fotograf\w*|look (for|at)|watch for|suggest\w*|tips?|hints?|photograph\w*)\b/, reply: forStop(replyObserve) },
  { id: 'pergunta-cientifica', match: /\b(pergunta( cientifica)?|objetivo( cientifico)?|hipotese|ciencia|science|scientific|question|objective|goal|hypothesis)\b/, reply: forStop(replyQuestion) },
  { id: 'tarefa', match: /\b(tarefa|o que (eu )?(faco|fazer|devo fazer|tenho que fazer|preciso fazer)|coletar|coleta|tasks?|what (do|should|must) i do|what to do|what am i (supposed|meant) to do|collect\w*|sampling)\b/, reply: forStop(replyTask) },
  { id: 'perigos', match: /\b(perigos?|relatos?|relatad\w*|rochas?|cortantes?|areia|obstaculos?|hazards?|dangers?|reported|rocks?|sharp|sand|obstacles?)\b/, reply: replyHazards },
  { id: 'diario', match: /\b(diario|amostras?|registros?|anotacoes|log|logs|logged|journal|samples?|entries|notes)\b/, reply: replyJournal },
  { id: 'terreno', match: /\b(declive|inclinacao|ingreme|terreno|subida|descida|relevo|slopes?|incline|steep|terrain|climb|descent|uphill|downhill)\b/, reply: replyTerrain },
  { id: 'altitude', match: /\b(altitude|altura|elevacao|elevation|height|how high)\b/, reply: replyAltitude },
  { id: 'veiculo', match: /\b(veiculo|rover|carro|a pe|vehicle|car|buggy|on foot)\b/, reply: replyVehicle },
  { id: 'tempo', match: /\b(que horas|horas sao|horario|ha quanto tempo|tempo de (saida|missao)|quanto tempo (ja|passou|estamos)|what time|the time|how long (have|has)|(eva|mission) time|elapsed|clock)\b/, reply: (context) => t`Tempo de saída: ${fmtDuration(context.elapsedH)}. Hora local: ${fmtClock(context.clockH)}. Faltam ${fmtDuration(context.suit.hoursToFinish)} para concluir o plano.` },
  { id: 'quanto-falta', match: /\b(falta\w*|distancia|longe|perto|chegar|chegada|chego|how far|how much (further|longer|more)|how long (until|till|to|left|is the)|distance|far|remaining|left to go|is left|arriv\w*|eta|get there|walk back|way back)\b/, reply: replyHowFar },
  { id: 'parada', match: (norm, context) => Boolean(mentionedStop(norm, context)), reply: forStop(replyStopSummary) },
  { id: 'rota', match: /\b(rota|plano|trajeto|caminho|percurso|paradas?|route|plan|path|track|itinerary|stops?)\b/, reply: replyRoute },
  { id: 'resumo', match: /\b(resumo|status|situacao|como (estamos|estou|esta tudo)|panorama|relatorio|summary|situation|how are we|how am i|overview|sitrep|report)\b/, reply: replyStatus },
  { id: 'confirmacao', match: /^(ok|okay|certo|feito|pronto|entendido|beleza|sim|done|ready|understood|got it|yes|roger|copy|right|alright)$/, reply: () => t`Certo. Sigo acompanhando.` },
]);

/** Nomes das intenções, para a documentação e para o teste. */
export const INTENT_IDS = Object.freeze(INTENTS.map((intent) => intent.id));

const matches = (intent, norm, context, raw) => (typeof intent.match === 'function' ? intent.match(norm, context, raw) : intent.match.test(norm));

/**
 * Motor por regras.
 * @param {string} question
 * @param {AssistantContext} context
 * @returns {{ intent: string, text: string, action: { type: string } | null }}
 */
export function answerByRules(question, context) {
  const raw = String(question ?? '').trim();
  const norm = normalize(raw);
  if (!context) return { intent: 'sem-contexto', text: t`Ainda não tenho os dados da saída. Tente de novo em instantes.`, action: null };
  if (!norm) return { intent: 'vazio', text: t`Não entendi a pergunta. Pode repetir?`, action: null };
  const intent = INTENTS.find((candidate) => (!candidate.when || candidate.when(context)) && matches(candidate, norm, context, raw));
  if (!intent) return { intent: 'desconhecido', text: UNKNOWN_TEXT, action: null };
  const result = intent.reply(context, { raw, norm });
  return typeof result === 'string' ? { intent: intent.id, text: result, action: null } : { intent: intent.id, text: '', action: null, ...result };
}

/**
 * Ponto único de entrada do assistente.
 * @param {string} question Pergunta digitada ou ditada.
 * @param {AssistantContext} context Estado da saída, só dados (buildContext, em contexto.js, monta um).
 * @param {(question: string, context: object) => object | Promise<object>} [engine] Motor de resposta.
 * @returns {Promise<{ intent: string, text: string, action: { type: string } | null }>}
 */
export async function askAssistant(question, context, engine = answerByRules) {
  return engine(question, context);
}

/** Perguntas rápidas para os botões, conforme o momento da saída: [rótulo, pergunta]. */
export function quickQuestions(context) {
  const common = [
    [t`É seguro continuar?`, t`É seguro continuar?`],
    [t`Oxigênio na volta?`, t`Quanto oxigênio sobra na volta?`],
    [t`Abrigo mais próximo?`, t`Onde fica o abrigo mais próximo?`],
  ];
  if (context.protocol) return [[t`Feito`, t`feito`], [t`Repetir passo`, t`repetir o passo`], [t`Encerrar emergência`, t`encerrar emergência`], ...common];
  const science = context.atStop
    ? [[t`Qual é a tarefa aqui?`, t`Qual é a tarefa aqui?`], [t`O que observar?`, t`O que observar aqui?`], [t`Por que esta parada importa?`, t`Por que esta parada importa?`]]
    : [[t`Quanto falta?`, t`Quanto falta?`], ...(nextPlannedStop(context) ? [[t`Por que a próxima parada importa?`, t`Por que a próxima parada importa?`]] : [])];
  return [...science, ...common, [t`Perigos relatados?`, t`Quais perigos foram relatados?`], [t`Resumo`, t`Resumo da situação`]];
}
