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
import { homeLine, habitatLine, pct, stopShortName, LIMITS } from './contexto.js';
import { EMERGENCIES, protocolStepText, protocolEvidenceText, shelterLine } from './protocolos.js';

const MODE_TEXT = Object.freeze({ walk: 'a pé', car: 'de veículo' });
// Palavras que identificam cada parada numa pergunta (sem acento, como no texto normalizado).
const STOP_WORDS = Object.freeze({
  H: ['habitat', 'argila'],
  1: ['greenheugh', 'pediment', 'arenito'],
  2: ['crista', 'detrito'],
  3: ['enxofre', 'canal'],
  4: ['boxwork'],
  5: ['sulfato'],
  D: ['destino'],
});
const EMERGENCY_WORDS = Object.freeze({
  storm: /tempestade|poeira/,
  solar: /solar|radiacao/,
  radio: /radio|comunicacao|contato/,
  o2: /oxigenio|o2/,
});
const UNKNOWN_TEXT = 'Não sei responder a isso. Só tenho os dados desta saída: rota, traje, ambiente, paradas, diário e perigos relatados. Tente, por exemplo, “quanto falta?” ou “é seguro continuar?”.';

/** Minúsculas, sem acento e sem pontuação: a forma em que as regras leem a pergunta. */
export const normalize = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/₂/g, '2')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// Com artigo, para contrair com preposição: "n" + título = "na parada 1" ou "no habitat".
const stopTitle = (stop) => (stop.id === 'H' ? 'o habitat' : `a parada ${stop.id}, ${stopShortName(stop)}`);
const nextPlannedStop = (context) => context.stops.find((stop) => stop.order === context.stopsReached) ?? null;

function mentionedStop(norm, context) {
  const byNumber = norm.match(/\bparada (\d|h|d)\b/);
  if (byNumber) return context.stops.find((stop) => stop.id.toLowerCase() === byNumber[1]) ?? null;
  if (/\bproxima\b/.test(norm)) return nextPlannedStop(context);
  return context.stops.find((stop) => STOP_WORDS[stop.id]?.some((word) => norm.includes(word))) ?? null;
}

const pickStop = (norm, context) => mentionedStop(norm, context) ?? context.focusStop;

function stopStatus(context, stop) {
  if (context.atStop && stop.id === context.focusStop.id) return ' Você está nela agora.';
  if (stop.id === 'H') return '';
  if (!stop.inPlan) return ' Essa parada não faz parte do plano desta saída.';
  if (stop.order < context.stopsReached) return ' Essa parada já foi visitada nesta saída.';
  return ` Faltam ${fmtDistance(stop.distM - context.position.distM)} de rota até lá.`;
}

function replyHowFar(context, { norm }) {
  if (context.finished) return 'A travessia terminou: você está de volta ao habitat.';
  if (/\b(habitat|base)\b/.test(norm)) {
    const away = context.habitat.distM >= LIMITS.atHabitatM && context.habitat.walkH !== null;
    return `${habitatLine(context)}.${away ? ` A pé pelo relevo: ${fmtDuration(context.habitat.walkH)}.` : ''}`;
  }
  const { target } = context;
  const rest = `Para fechar o plano inteiro faltam ${fmtDuration(context.suit.hoursToFinish)}.`;
  if (target.kind === 'return') return `As coletas terminaram. Faltam ${fmtDistance(target.distM)} até o habitat, chegada em ${fmtDuration(target.etaH)}.`;
  if (target.kind === 'dwell') {
    const next = nextPlannedStop(context);
    const after = next
      ? `Depois, são ${fmtDistance(next.distM - context.position.distM)} até a parada ${next.id}, ${stopShortName(next)}.`
      : 'Depois dela começa o retorno ao habitat.';
    return `Você está em coleta na parada ${target.stopId}, ${target.name}. ${after} ${rest}`;
  }
  return `Faltam ${fmtDistance(target.distM)} até a parada ${target.stopId}, ${target.name}: cerca de ${fmtDuration(target.etaH)}, com ${fmtSigned(target.gainM)} m de desnível. ${habitatLine(context)}. ${rest}`;
}

function replySafety(context) {
  if (context.finished) return 'A saída terminou: você está no habitat.';
  const critical = context.alerts.filter((alert) => alert.level === 'critico');
  const warnings = context.alerts.filter((alert) => alert.level === 'atencao');
  const suit = `O₂ em ${pct(context.suit.o2Pct)}, margem de ${fmtDuration(context.suit.marginH)} ao fim do plano, bateria em ${pct(context.suit.batteryPct)}.`;
  if (critical.length) return `Não é seguro continuar. ${critical.map((alert) => alert.text).join('. ')}. ${critical[0].action}`;
  if (warnings.length) return `Dá para continuar, com atenção: ${warnings.map((alert) => alert.text).join('; ')}. ${warnings[0].action} ${suit}`;
  return `Sim, é seguro continuar: nenhum alerta ativo. ${suit} ${habitatLine(context)}.`;
}

function replyOxygen(context) {
  const { suit, habitat } = context;
  const arrival = habitat.o2ArrivalPct >= 0 ? `chega ao habitat com ${pct(habitat.o2ArrivalPct)}` : 'o O₂ acaba antes de chegar';
  const way = habitat.walkH !== null ? `a pé pelo relevo, ${fmtDuration(habitat.walkH)}` : homeLine(context);
  const back = habitat.distM < LIMITS.atHabitatM ? '' : ` Se voltar agora (${way}), gasta cerca de ${pct(habitat.o2UsePct)} e ${arrival}.`;
  const plan = suit.marginH >= 0
    ? ` Seguindo o plano até o fim, sobram ${pct(suit.planEndO2Pct)}, uma margem de ${fmtDuration(suit.marginH)}.`
    : ` O plano inteiro não fecha: faltam ${fmtDuration(-suit.marginH)} de autonomia.`;
  return `O₂ em ${pct(suit.o2Pct)} (telemetria simulada).${back}${plan}${suit.leaking ? ' Há um vazamento simulado em curso.' : ''}`;
}

function replyBattery({ suit }) {
  const end = suit.batteryEndPct >= 0 ? `termina a saída com cerca de ${pct(suit.batteryEndPct)}` : 'ela acaba antes do fim do plano';
  return `Bateria do traje em ${pct(suit.batteryPct)} (simulada). No ritmo do plano, ${end}.`;
}

function replyShelter(context) {
  const cabin = context.position.onFoot ? '' : ' Você está na cabine do veículo agora.';
  return `${shelterLine(context)}${cabin}`;
}

function replyComms({ comms, assumptions }) {
  if (comms.failed) return 'Falha de rádio com o habitat (simulada). O visor segue funcionando: rota, relevo, diário e perigos relatados estão guardados aqui.';
  if (comms.lineOfSight === null) return 'Não tenho a análise de linha de visada para este plano, então não sei dizer se há rádio direto com o habitat.';
  const basis = `A conta usa o relevo real e alturas de antena que são hipótese da equipe (mastro de ${assumptions.habitatMastM} m no habitat, ${assumptions.suitAntennaM} m no traje).`;
  if (comms.lineOfSight) return `Há linha de visada de rádio com o mastro do habitat. ${basis}`;
  return `Sem linha de visada com o mastro do habitat: o relevo tapa o sinal direto. Seguindo a rota, a visada volta em ${fmtDistance(comms.backInM)}. ${basis}`;
}

function replyNoReturn(context) {
  const reserve = `a reserva de ${pct(context.assumptions.o2ReservePct)} (hipótese da equipe)`;
  const now = context.habitat.walkH !== null ? ` Agora, a volta a pé pelo relevo leva ${fmtDuration(context.habitat.walkH)} e você chegaria com ${pct(context.habitat.o2ArrivalPct)} de O₂.` : '';
  if (!context.noReturn) return `Este plano não tem ponto sem volta a pé: em toda a rota o O₂ previsto cobre a caminhada até o habitat com ${reserve}.${now}`;
  const { aheadM } = context.noReturn;
  const where = aheadM > 0 ? `fica ${fmtDistance(aheadM)} à frente na rota` : `ficou ${fmtDistance(-aheadM)} para trás na rota`;
  return `O ponto sem volta a pé deste plano ${where}. Depois dele, o O₂ previsto não cobre a caminhada até o habitat com ${reserve}.${now}`;
}

function replySources(context, { norm }) {
  const aboutProtocol = /\b(protocolo|passos?|disso|isso|desse|deste)\b/.test(norm);
  const asked = aboutProtocol ? Object.keys(EMERGENCY_WORDS).find((id) => EMERGENCY_WORDS[id].test(norm)) ?? context.protocol?.id : null;
  if (asked && context.protocols?.[asked]) return `Base do protocolo de ${EMERGENCIES[asked].label.toLowerCase()}, que é proposta da equipe: ${protocolEvidenceText(asked, context)}`;
  return 'Reais: relevo, declive, altitude e rotas (MSL Gale Merged DEM, USGS Astrogeology / JPL-Caltech / NASA), a linha de visada de rádio calculada sobre esse relevo, a taxa de radiação (média medida pelo RAD do Curiosity) e a faixa de temperatura (REMS do Curiosity). Estimada: a temperatura de cada hora, entre os extremos medidos. Simulados: traje, vento e emergências. Os textos das paradas são o roteiro da equipe. Os protocolos são propostas da equipe, cada um com fatos de missão e fonte: pergunte, por exemplo, “qual a fonte do protocolo de evento solar?”.';
}

function replyRadiation({ env, emergencies }) {
  const solar = emergencies.solar ? ` Há um evento solar simulado em curso: a taxa está ${SIM.solarEventFactor}× acima do normal. Vá para o habitat.` : '';
  return `Taxa de ${fmtNumber(env.radiationUsvH)} µSv/h e dose acumulada de ${fmtNumber(env.doseUsv)} µSv nesta saída. A taxa é a média medida pelo RAD do Curiosity em Gale; a dose da saída é essa taxa vezes o tempo, não uma medição.${solar}`;
}

function replyTerrain({ env, riskZone }) {
  const ahead = env.slopeAheadDeg >= SIM.slopeWarnDeg ? `, acima do limite de atenção de ${SIM.slopeWarnDeg}°` : '';
  return `Declive de ${fmtSigned(env.slopeDeg)}° onde você está; nos próximos ${SIM.slopeLookaheadM} m chega a ${fmtNumber(env.slopeAheadDeg)}°${ahead}. O declive vem do relevo real (DEM do USGS). A zona de rochas cortantes dos dados, de posição aproximada, fica a ${fmtDistance(riskZone.edgeM)} ${riskZone.side}.`;
}

function replyAltitude({ position, target }) {
  const gain = target.kind === 'dwell' ? '' : ` O próximo destino (${target.name}) fica ${fmtSigned(target.gainM)} m em relação a você.`;
  return `Você está a ${fmtNumber(position.elevM)} m de altitude, pelo relevo real do USGS.${gain}`;
}

function replyHazards({ hazards, riskZone }) {
  const zone = `A zona de rochas cortantes dos dados, de posição aproximada, fica a ${fmtDistance(riskZone.edgeM)} ${riskZone.side}.`;
  if (!hazards.total) return `Nenhum perigo relatado por astronautas até agora. ${zone} Para relatar, toque em “Relatar perigo” ou diga “relatar perigo areia fofa”.`;
  const { nearest } = hazards;
  const note = nearest.note ? `, com a nota “${nearest.note}”` : '';
  const origin = nearest.previous ? 'de uma saída anterior' : 'relatado nesta saída';
  return `Há ${plural(hazards.total, 'perigo relatado guardado', 'perigos relatados guardados')}. O mais próximo: ${nearest.label.toLowerCase()} a ${fmtDistance(nearest.distM)} ${nearest.side}${note}, ${origin}. ${zone}`;
}

function replyJournal({ journal }) {
  const last = journal.lastSample ? ` Última amostra: “${journal.lastSample}”.` : '';
  return `O diário tem ${plural(journal.samples, 'amostra', 'amostras')}, ${plural(journal.hazardReports, 'relato de perigo', 'relatos de perigo')} e ${plural(journal.entries, 'registro', 'registros')} no total.${last} Abra a aba Diário para rever ou exportar.`;
}

function replyRoute(context) {
  const planned = context.stops.filter((stop) => stop.order >= 0);
  const done = planned.filter((stop) => stop.order < context.stopsReached).map((stop) => stop.id);
  const todo = planned.filter((stop) => stop.order >= context.stopsReached).map((stop) => `${stop.id} (${stopShortName(stop)})`);
  const blocked = context.plan.blockedLegs.length ? ` Trechos sem passagem para o veículo, feitos a pé: ${context.plan.blockedLegs.join(', ')}.` : '';
  return `Plano ${MODE_TEXT[context.mode]} com ${plural(context.plan.stopCount, 'parada', 'paradas')}, ${fmtKm(context.plan.totalKm)} e cerca de ${fmtDuration(context.plan.hours)} no total. Visitadas: ${done.join(', ') || 'nenhuma'}. Faltam: ${todo.join(', ') || 'nenhuma, só o retorno ao habitat'}.${blocked}`;
}

function replyStatus(context) {
  const { target, suit, alerts, journal } = context;
  const where = context.finished ? 'saída concluída' : target.kind === 'dwell' ? `em coleta na parada ${target.stopId}` : `${fmtDistance(target.distM)} até ${target.name}`;
  const alertText = alerts.length ? `Alertas: ${alerts.map((alert) => alert.text).join('; ')}.` : 'Nenhum alerta ativo.';
  return `Resumo: ${fmtDuration(context.elapsedH)} de saída, ${where}. O₂ em ${pct(suit.o2Pct)}, bateria em ${pct(suit.batteryPct)}, margem de ${fmtDuration(suit.marginH)}. ${alertText} Diário com ${plural(journal.samples, 'amostra', 'amostras')}.`;
}

function replyProtocolInfo(context, { norm }) {
  const asked = Object.keys(EMERGENCY_WORDS).find((id) => EMERGENCY_WORDS[id].test(norm));
  if (context.protocol && context.protocols?.[context.protocol.id] && (!asked || asked === context.protocol.id)) {
    return `Protocolo de ${EMERGENCIES[context.protocol.id].label.toLowerCase()} em andamento. ${protocolStepText(context.protocol, context)}`;
  }
  if (asked && context.protocols?.[asked]) {
    const steps = context.protocols[asked].steps.map((step, index) => `${index + 1}) ${step}`).join(' ');
    return `Protocolo para ${EMERGENCIES[asked].label.toLowerCase()}, proposta da equipe: ${steps} ${EMERGENCIES[asked].live(context)}`;
  }
  return 'Nenhuma emergência em andamento. Conduzo quatro protocolos propostos pela equipe: tempestade de poeira, evento solar, perda de rádio e oxigênio baixo. Pergunte, por exemplo, “o que fazer numa tempestade de poeira?”.';
}

function replyWhy(context, stop) {
  if (!stop.imp) return `${capitalize(stopTitle(stop))}, é um ponto escolhido no mapa pela tripulação. Não tenho, nos dados, um texto sobre a importância científica desse ponto. O que há: ${stop.sci}`;
  return `${capitalize(stopTitle(stop))}${stop.id === 'H' ? '' : ','} é o capítulo “${stop.ch}” da linha do tempo. ${stop.imp} ${stop.int ?? ''}`.trim();
}
const replyQuestion = (context, stop) => `Objetivo n${stopTitle(stop)}: ${stop.sci} Pergunta científica: ${stop.q}`;
const riskText = (stop) => (stop.risk ? ` Risco anotado no roteiro: ${stop.risk}.` : '');

function replyTask(context, stop) {
  const here = context.atStop && stop.id === context.focusStop.id;
  const tail = here ? ' Quando terminar, registre a amostra no diário.' : stopStatus(context, stop);
  return `${here ? 'Tarefa aqui' : 'Tarefa'} n${stopTitle(stop)}: ${stop.task}${riskText(stop)}${tail}`;
}

function replyObserve(context, stop) {
  return `Sugestão montada só com o roteiro d${stopTitle(stop)}. O que fazer: ${stop.task} O que procurar: ${stop.sci}${stop.int ? ` ${stop.int}` : ''}${riskText(stop)} Não tenho dados além do roteiro para sugerir mais do que isso.`;
}

function replyStopSummary(context, stop) {
  return `${capitalize(stopTitle(stop))}, capítulo “${stop.ch}”. ${stop.sci} Pergunta científica: ${stop.q} Tarefa: ${stop.task}${riskText(stop)}${stopStatus(context, stop)}`;
}

// Comando é ordem direta: verbo no começo e sem interrogação. Uma pergunta ("há algum relato
// de perigo perto?") nunca pode gravar um perigo, registrar amostra ou encerrar emergência.
const isOrder = (raw) => !raw.trim().endsWith('?');
const HAZARD_ORDER = /^(relatar?|relate|marcar?|marque|sinalizar?|sinalize|reportar?|reporte|registrar?|registre)\b.*\b(perigo|rocha|pedra|areia|declive|buraco|obstaculo)\b|^perigo (de |com |em )?(rocha|pedra|areia|declive|buraco|outro)\b/;
const SAMPLE_ORDER = /^(registrar?|registre|anotar?|anote|gravar?|grave|salvar?|salve)\b.*\b(amostra|observacao|coleta)\b/;
const END_ORDER = /^(encerrar?|encerre|cancelar?|cancele|terminar?|termine)\b.*\b(emergencia|protocolo)\b|^fim d[ao] (emergencia|protocolo)\b/;
// Palavras do comando, na grafia original, para sobrar só a nota de quem falou.
const HAZARD_WORDS = /^\s*\S+\s+((um|uma|o|a)\s+)?(perigo\s*)?((de|com|em)\s+)?(outro\s*)?/i;
const SAMPLE_WORDS = /^\s*\S+\s+((uma|a|esta|essa)\s+)?(amostra|observa[cç][aã]o|coleta)\s*/i;

// Nota: o que vem depois dos dois-pontos ou, sem eles, depois das palavras do comando.
function noteOf(raw, commandWords) {
  const note = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw.replace(commandWords, '')).trim();
  return /[\p{L}\p{N}]/u.test(note) ? note : '';
}

function hazardCommand(context, { raw, norm }) {
  let hazardType = 'outro';
  if (/rocha|cortante|pedra/.test(norm)) hazardType = 'rocha';
  else if (/areia|fofa/.test(norm)) hazardType = 'areia';
  else if (/declive|inclin|ingreme|barranco|ladeira/.test(norm)) hazardType = 'declive';
  const note = raw.includes(':') || hazardType === 'outro' ? noteOf(raw, HAZARD_WORDS) : '';
  return { action: { type: 'report-hazard', hazardType, note } };
}

const sampleCommand = (context, { raw }) => ({ action: { type: 'record-sample', note: noteOf(raw, SAMPLE_WORDS) } });

const forStop = (reply) => (context, question) => {
  if (/\bproxima\b/.test(question.norm) && !nextPlannedStop(context)) return 'Não há próxima parada: as coletas do plano terminaram e o destino agora é o habitat.';
  return reply(context, pickStop(question.norm, context));
};
const inProtocol = (context) => Boolean(context.protocol);

// A primeira regra que casa responde: as mais específicas vêm antes.
const INTENTS = Object.freeze([
  { id: 'protocolo-avancar', when: inProtocol, match: /^(feito|pronto|ok|okay|certo|confirmo|confirmado|concluido|sim|proximo( passo)?|passo seguinte|seguinte|pode seguir|ja fiz|entendido)$/, reply: () => ({ action: { type: 'protocol-advance' } }) },
  { id: 'protocolo-repetir', when: inProtocol, match: /\b(repet\w*|de novo|qual (e )?o passo|passo atual)\b/, reply: (context) => protocolStepText(context.protocol, context) },
  { id: 'protocolo-encerrar', match: (norm, context, raw) => isOrder(raw) && END_ORDER.test(norm), reply: () => ({ action: { type: 'protocol-end' } }) },
  { id: 'relatar-perigo', match: (norm, context, raw) => isOrder(raw) && HAZARD_ORDER.test(norm), reply: hazardCommand },
  { id: 'registrar-amostra', match: (norm, context, raw) => isOrder(raw) && SAMPLE_ORDER.test(norm) && !/\bperigo\b/.test(norm), reply: sampleCommand },
  { id: 'pausar', match: /^(pausar?|pausa|pare|parar)( a simulacao)?$/, reply: () => ({ action: { type: 'pause' } }) },
  { id: 'continuar', match: /^(continuar?|retomar?|seguir|segue|vamos)( a simulacao)?$/, reply: () => ({ action: { type: 'resume' } }) },
  { id: 'identidade', match: /\b(quem e voce|voce e (uma? )?(ia|robo|inteligencia|humano|pessoa|modelo)|como voce funciona|chatgpt|claude|llm)\b/, reply: () => 'Sou um assistente simulado por regras, sem modelo de linguagem por trás. Reconheço a intenção da pergunta e respondo só com os dados desta saída. Quando não tenho o dado, eu digo que não sei.' },
  { id: 'saudacao', match: /^(oi|ola|bom dia|boa tarde|boa noite|e ai|alo)\b/, reply: () => 'Olá. Estou acompanhando a saída. Pergunte sobre rota, segurança, traje ou a ciência das paradas, ou peça para relatar um perigo.' },
  { id: 'agradecimento', match: /\b(obrigad[oa]|valeu|agradeco)\b/, reply: () => 'De nada. Sigo acompanhando.' },
  { id: 'ajuda', match: /\b(ajuda|o que voce (sabe|pode|consegue)|como (te |lhe )?us(o|ar)|comandos|o que posso perguntar)\b/, reply: () => 'Respondo sobre: quanto falta, se é seguro continuar, oxigênio e bateria, abrigo, radiação, temperatura, declive, altitude, a ciência de cada parada, o diário e os perigos relatados. Comandos: “relatar perigo areia fofa”, “registrar amostra: observação”, “pausar”, “continuar” e, em emergência, “feito” para o próximo passo.' },
  { id: 'previsao', match: /\b(previsao|amanha|vai (ter|chover|ventar)|quando (vai|vem))\b/, reply: () => 'Não sei. Os dados desta saída não trazem previsão de clima nem de clima espacial, só o que acontece agora na simulação.' },
  { id: 'fonte', match: /\b(fontes?|evidencias?|referencias?|de onde vem|de onde vieram|baseado em que|e real|sao reais)\b/, reply: replySources },
  { id: 'sem-volta', match: /\b(sem (volta|retorno)|ate onde (posso|da para|consigo) ir)\b/, reply: replyNoReturn },
  { id: 'protocolo', match: (norm) => /\b(protocolo|procedimento|emergencia)\b/.test(norm) || (/\b(o que (eu )?(faco|fazer|devo fazer)|como agir|e se)\b/.test(norm) && Object.values(EMERGENCY_WORDS).some((words) => words.test(norm))), reply: replyProtocolInfo },
  { id: 'oxigenio', match: /\b(oxigenio|o2|respir\w*|autonomia)\b/, reply: replyOxygen },
  { id: 'bateria', match: /\b(bateria|energia|carga)\b/, reply: replyBattery },
  { id: 'abrigo', match: /\b(abrigo|abrigar|refugio|proteger|onde (fica|esta) o habitat|(voltar|retornar|retorno) (para|pro|ao|a) (o )?(habitat|base))\b/, reply: replyShelter },
  { id: 'radiacao', match: /\b(radiacao|dose|solar|sievert|clima espacial)\b/, reply: replyRadiation },
  { id: 'temperatura', match: /\b(temperatura|frio|quente|calor)\b/, reply: ({ env }) => `Temperatura do ar em ${fmtNumber(env.airTempC)} °C. É uma estimativa para esta hora, entre a mínima e a máxima medidas pelo REMS do Curiosity; não é medição direta.` },
  { id: 'comunicacao', match: /\b(radio|comunicacao|sinal|visada)\b/, reply: replyComms },
  { id: 'seguranca', match: /\b(seguro|segura|seguranca|posso (continuar|seguir|prosseguir)|devo (continuar|voltar|parar)|algum (risco|alerta)|alertas?)\b/, reply: replySafety },
  { id: 'importancia', match: /\b(por que|porque|pra que|para que|importa\w*|importancia|relevan\w*|vale a pena)\b/, reply: forStop(replyWhy) },
  { id: 'observar', match: /\b(observ\w*|olhar|reparar|procurar|sugest\w*|sugere|dica|fotograf\w*)\b/, reply: forStop(replyObserve) },
  { id: 'pergunta-cientifica', match: /\b(pergunta( cientifica)?|objetivo( cientifico)?|hipotese|ciencia)\b/, reply: forStop(replyQuestion) },
  { id: 'tarefa', match: /\b(tarefa|o que (eu )?(faco|fazer|devo fazer|tenho que fazer|preciso fazer)|coletar|coleta)\b/, reply: forStop(replyTask) },
  { id: 'perigos', match: /\b(perigos?|relatos?|relatad\w*|rochas?|cortantes?|areia|obstaculos?)\b/, reply: replyHazards },
  { id: 'diario', match: /\b(diario|amostras?|registros?|anotacoes)\b/, reply: replyJournal },
  { id: 'terreno', match: /\b(declive|inclinacao|ingreme|terreno|subida|descida|relevo)\b/, reply: replyTerrain },
  { id: 'altitude', match: /\b(altitude|altura|elevacao)\b/, reply: replyAltitude },
  { id: 'veiculo', match: /\b(veiculo|rover|carro|a pe)\b/, reply: (context) => `Plano ${MODE_TEXT[context.mode]}. Agora você está ${context.position.onFoot ? 'a pé' : 'na cabine do veículo'}.${context.plan.blockedLegs.length ? ` Trechos sem passagem para o veículo: ${context.plan.blockedLegs.join(', ')}.` : ''}` },
  { id: 'tempo', match: /\b(que horas|horas sao|horario|ha quanto tempo|tempo de (saida|missao)|quanto tempo (ja|passou|estamos))\b/, reply: (context) => `Tempo de saída: ${fmtDuration(context.elapsedH)}. Hora local: ${fmtClock(context.clockH)}. Faltam ${fmtDuration(context.suit.hoursToFinish)} para concluir o plano.` },
  { id: 'quanto-falta', match: /\b(falta\w*|distancia|longe|perto|chegar|chegada|chego)\b/, reply: replyHowFar },
  { id: 'parada', match: (norm, context) => Boolean(mentionedStop(norm, context)), reply: forStop(replyStopSummary) },
  { id: 'rota', match: /\b(rota|plano|trajeto|caminho|percurso|paradas?)\b/, reply: replyRoute },
  { id: 'resumo', match: /\b(resumo|status|situacao|como (estamos|estou|esta tudo)|panorama|relatorio)\b/, reply: replyStatus },
  { id: 'confirmacao', match: /^(ok|okay|certo|feito|pronto|entendido|beleza|sim)$/, reply: () => 'Certo. Sigo acompanhando.' },
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
  if (!context) return { intent: 'sem-contexto', text: 'Ainda não tenho os dados da saída. Tente de novo em instantes.', action: null };
  if (!norm) return { intent: 'vazio', text: 'Não entendi a pergunta. Pode repetir?', action: null };
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
    ['É seguro continuar?', 'É seguro continuar?'],
    ['Oxigênio na volta?', 'Quanto oxigênio sobra na volta?'],
    ['Abrigo mais próximo?', 'Onde fica o abrigo mais próximo?'],
  ];
  if (context.protocol) return [['Feito', 'feito'], ['Repetir passo', 'repetir o passo'], ['Encerrar emergência', 'encerrar emergência'], ...common];
  const science = context.atStop
    ? [['Qual é a tarefa aqui?', 'Qual é a tarefa aqui?'], ['O que observar?', 'O que observar aqui?'], ['Por que esta parada importa?', 'Por que esta parada importa?']]
    : [['Quanto falta?', 'Quanto falta?'], ...(nextPlannedStop(context) ? [['Por que a próxima parada importa?', 'Por que a próxima parada importa?']] : [])];
  return [...science, ...common, ['Perigos relatados?', 'Quais perigos foram relatados?'], ['Resumo', 'Resumo da situação']];
}
