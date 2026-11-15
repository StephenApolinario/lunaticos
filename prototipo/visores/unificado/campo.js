// Assistente de campo do visor único: a conversa, a ciência das paradas, o diário e os perigos
// relatados do Cientista, falando com a mesma voz do oficial de protocolo do Guardião.
// Aqui só mora a cola com o navegador. O motor de respostas, o diário, o relato de perigos e as
// telas vêm de ../cientista/; o contexto do assistente é montado em contexto.js.

import { fmtDistance, fmtDuration, fmtKm } from '../../src/format.js';
import { clamp } from '../../src/geo.js';
import { plainText } from '../../src/dom.js';
import { PROTOCOLS } from '../guardiao/catalog.js';
import { protocolView } from '../guardiao/protocols.js';
import { goStepText } from '../guardiao/rules.js';
import { createPanel } from '../cientista/painel.js';
import { createVoice } from '../cientista/voz.js';
import { createConversation } from '../cientista/conversa.js';
import { createSceneMarkers } from '../cientista/marcadores.js';
import { describeStops, stopShortName } from '../cientista/contexto.js';
import { bindProtocols } from '../cientista/protocolos.js';
import { createJournal, journalToText, downloadText, fmtPosition, EXPORT_FILE } from '../cientista/diario.js';
import { HAZARD_TYPES, createHazardStore, describeHazard, locateHazards, hazardWarning, newId } from '../cientista/perigos.js';
import { assistantContext, unifiedQuickQuestions } from './contexto.js';
import { createAssistantEngine } from './ia.js';
import { voiceLine } from './guia.js';

const MODE_TEXT = Object.freeze({ walk: 'a pé', car: 'de veículo' });
// Prioridade de fala (a mesma escala do Guardião, 0 a 3): resposta a uma pergunta fica acima do
// aviso de rotina e abaixo de perigo e emergência.
const ANSWER_PRIORITY = 2;
const PANEL_INTERVAL_S = 0.2;
// A instrução de rota muda muitas vezes por minuto em velocidade acelerada: a voz respeita um intervalo.
const ROUTINE_SPEECH_GAP_S = 5;
// O mesmo aviso ou alerta só volta ao histórico e à voz depois deste intervalo (segundos de relógio):
// uma condição que oscila (uma rampa no limite, por exemplo) não pode encher a conversa.
const REPEAT_COOLDOWN_S = 45;
// Quanto tempo uma resposta fica na linha do assistente antes de ela voltar à frase do momento.
const HOLD = Object.freeze({ perCharS: 0.07, minS: 6, maxS: 16 });

const planSize = (plan) => {
  if (plan.isCustom) return 'rota livre com pontos escolhidos no mapa';
  return plan.stopCount === 1 ? '1 parada' : `${plan.stopCount} paradas`;
};

// Resumo de segurança do plano, calculado sobre o relevo real (plan.safety).
function safetyBriefing(plan) {
  const assessed = plan.safety;
  if (!assessed) return '';
  const gaps = assessed.commsGaps.length;
  const comms = gaps
    ? `${fmtDistance(assessed.commsLostM)} da rota ficam sem visada de rádio com o habitat, em ${gaps === 1 ? '1 trecho' : `${gaps} trechos`}`
    : 'há visada de rádio com o habitat em toda a rota';
  const noReturn = assessed.noReturn ? `o ponto de não retorno a pé fica a ${fmtDistance(assessed.noReturn.distM)} do início` : 'não há ponto de não retorno a pé';
  return ` Pelo relevo real (antenas e reserva de O₂ são hipóteses da equipe): ${comms}; ${noReturn}.`;
}

function scienceStatus(context) {
  const { target } = context;
  if (context.finished) return 'Saída concluída · de volta ao habitat';
  if (context.atStop) return context.paused ? 'Em coleta · simulação pausada para o registro' : `Em coleta · faltam ${fmtDuration(target.etaH)}`;
  if (target.kind === 'return') return `${target.name} a ${fmtDistance(target.distM)}`;
  return `Próxima parada · ${fmtDistance(target.distM)} · chegada em ${fmtDuration(target.etaH)}`;
}

/**
 * @param {{
 *   drawer: HTMLElement, markersLayer: HTMLElement, pinsLayer: HTMLElement, camera: import('three').PerspectiveCamera,
 *   terrain: { heightAt: (x: number, z: number) => number },
 *   safety: { protocolFor: (id: string) => object, assumptions: object },
 *   audio: ReturnType<typeof import('../guardiao/audio.js').createAudio>,
 *   live: () => { weather?: object | null, dose?: object | null, lsDeg: number },
 *   host: { session: () => object, confirm: () => void, decide: (choice: 'abortar'|'seguir') => void,
 *     pause: (paused: boolean) => void, endScenario: (id: string) => void, onChange: () => void,
 *     setPanel: (panel: string, on: boolean) => void, setLayer: (layer: string) => void,
 *     setBlock: (block: string, on: boolean) => void, flash: (targets: string[]) => void,
 *     focusDrawerButton: () => void },
 * }} deps `host` dá a sessão atual do Guardião e liga as ações da conversa a ela; `onChange` pede
 *   ao visor para atualizar os botões (gaveta aberta, voz, microfone).
 */
const PINS_REFRESH_S = 0.5;

export function createField({ drawer, markersLayer, pinsLayer, camera, terrain, safety, audio, host, live, planIn = null, tripTo = null }) {
  const store = createHazardStore();
  const markers = createSceneMarkers(markersLayer, camera, terrain);
  // Leituras que a IA fixa no visor a pedido ("coloca na tela a velocidade média"): cartões na
  // mesma fileira dos blocos do canto (`pinsLayer`, do HUD).
  let pinsKey = '';
  let pinsWaitS = 0;
  function renderPins(pins) {
    const key = pins.map((pin) => `${pin.id}=${pin.valor}`).join('|');
    if (key === pinsKey) return;
    pinsKey = key;
    pinsLayer.replaceChildren(...pins.map((pin) => {
      const card = document.createElement('div');
      const label = document.createElement('small');
      const value = document.createElement('strong');
      card.className = 'ia-pino';
      label.textContent = pin.rotulo;
      value.textContent = pin.valor;
      card.append(label, value);
      return card;
    }));
  }
  const protocols = bindProtocols(safety.protocolFor);
  const mic = createVoice();
  const acked = new Set();

  let journal = createJournal();
  let stops = [];
  let outingId = '';
  let snapshot = null;
  let context = null;
  let located = [];
  let open = false;
  let greeted = false;
  let quickKey = '';
  let lineKey = null;
  let saidAtS = new Map();
  let seenProtocols = new Map();
  let clockS = 0;
  let panelWaitS = 0;
  let lastRoutineS = -Infinity;
  let speechPriority = ANSWER_PRIORITY;
  let isUrgentSpeech = false;
  let holding = false;
  let held = null;

  // Uma voz só: quem fala é o áudio do Guardião (com prioridade e a preferência guardada);
  // do módulo de voz do Cientista só se usa a escuta.
  // Com o microfone aberto a IA se cala, para não falar por cima do astronauta nem entrar na
  // gravação: só perigo, emergência e passo de protocolo ainda são ditos. O resto fica na tela.
  const isMicOpen = () => conversation.voiceState().listening !== null;
  const voice = Object.freeze({
    canSpeak: audio.hasVoice,
    canListen: mic.canListen,
    isSpeaking: () => audio.voiceOn,
    speak: (text) => { if (isUrgentSpeech || !isMicOpen()) audio.speak(text, speechPriority); },
    setSpeaking(on) {
      if (Boolean(on) !== audio.voiceOn) audio.toggleVoice();
      return audio.voiceOn;
    },
    // Abrir o microfone corta a fala em curso (a voz neural e a do sistema).
    listen: (handlers) => { audio.silence(); return mic.listen(handlers); },
    stopListening: mic.stopListening,
  });

  const panel = createPanel(drawer, {
    onAsk: (question) => conversation.ask(question),
    onMic: listenTo,
    onVoiceToggle: () => conversation.toggleSpeaking(),
    onRecordSample: recordSample,
    onContinue: () => { host.pause(false); closeDrawer(true); },
    onSuggest: () => { openDrawer('chat'); conversation.ask('O que observar aqui?'); },
    onExport: exportJournal,
    onDeleteHazard: deleteHazard,
    onClose: () => closeDrawer(true),
  });
  // A conversa é com a IA de bordo; ela lê os dados da saída por estas funções e age pelo mesmo `runAction`.
  const assistant = createAssistantEngine({
    getContext,
    getSession: host.session,
    safety,
    live,
    planIn,
    tripTo,
    terrain,
    runAction: (action) => runAction(action),
    onStatus: (text) => panel.chat.setBusy(text),
    onHealth: () => { panel.setEngineNote(assistant.note()); host.onChange(); },
  });
  const conversation = createConversation({
    getContext,
    onMessage: showMessage,
    onAction: runAction,
    voice,
    onVoiceChange: syncVoice,
    engine: assistant.engine,
  });

  // O contexto do assistente é montado sob demanda. A sessão e o protocolo em condução são os de
  // agora (uma ação pode ter mudado os dois depois do último quadro); alertas e guia são do quadro.
  function getContext() {
    if (!snapshot) return null;
    if (!context) {
      const session = host.session();
      const proto = protocolView(session.protocols, session.r, goStepText);
      context = assistantContext({ ...snapshot, session, proto, stops, hazards: store.list(), outingId, journal: journal.stats(), protocols, assumptions: safety.assumptions });
    }
    return context;
  }

  // ---------- Voz e mensagens ----------

  function syncVoice() {
    panel.setVoiceState(conversation.voiceState());
    host.onChange();
  }

  // Toda fala entra no mesmo histórico. Respostas e confirmações também ocupam a linha do
  // assistente no HUD por alguns segundos; a frase do momento (protocolo, alerta) já está nela.
  function showMessage(message) {
    panel.chat.addMessage(message);
    if (message.from === 'user' || !holding) return;
    held = { text: message.text, untilS: clockS + clamp(message.text.length * HOLD.perCharS, HOLD.minS, HOLD.maxS) };
  }

  /** Fala do assistente em resposta a algo que o astronauta fez. */
  function say(text, from = 'assistant') {
    conversation.say(text, from);
  }

  // Fala por iniciativa do assistente: entra no histórico e é dita com a prioridade do assunto.
  function announce(text, priority) {
    holding = false;
    speechPriority = priority;
    isUrgentSpeech = priority >= ANSWER_PRIORITY;
    conversation.say(text, isUrgentSpeech ? 'alert' : 'assistant');
    speechPriority = ANSWER_PRIORITY;
    isUrgentSpeech = false;
    holding = true;
  }

  // O que foi ditado na conversa vira pergunta; na observação da amostra, vira texto do campo.
  function listenTo(target) {
    conversation.listen(target, target === 'note' ? (text) => panel.science.appendNote(text) : (text) => conversation.ask(text));
  }

  // ---------- Ações da conversa, ligadas ao Guardião ----------

  function endProtocol() {
    const protocol = getContext()?.guardiao.protocol;
    if (!protocol) {
      say('Não há protocolo de emergência em andamento.');
    } else if (protocol.simulated) {
      host.endScenario(protocol.id);
      say(`Fim da simulação: “${protocol.name}”. O protocolo fecha e o plano é retomado.`);
    } else {
      say(`Não dá para encerrar: a condição que abriu o protocolo “${protocol.name}” continua ativa. Passo ${protocol.stepNumber} de ${protocol.stepCount}: ${protocol.stepText}`);
    }
  }

  const ACTIONS = Object.freeze({
    'report-hazard': (action) => report(action.hazardType, action.note),
    'record-sample': (action) => recordSample(action.note),
    'protocol-advance': () => host.confirm(),
    'protocol-decide': (action) => { if (action.choice === 'abortar' || action.choice === 'seguir') host.decide(action.choice); },
    'protocol-end': endProtocol,
    pause: () => { host.pause(true); say('Simulação pausada.'); },
    resume: () => { host.pause(false); say('Simulação retomada.'); },
    'hud-panel': (action) => host.setPanel(action.panel, action.on),
    'hud-layer': (action) => host.setLayer(action.layer),
    'hud-block': (action) => host.setBlock(action.block, action.on),
    'hud-flash': (action) => host.flash(action.targets),
  });

  // A ação vem do motor do assistente (amanhã, de um modelo): só roda se for conhecida.
  function runAction(action) {
    if (Object.hasOwn(ACTIONS, action.type)) ACTIONS[action.type](action);
  }

  // ---------- Diário, amostras e perigos ----------

  function refreshJournal() {
    context = null;
    panel.journal.render(journal.entries(), store.list(), outingId);
  }

  function log(kind, text, stopId = null) {
    const moment = getContext();
    if (!moment) return;
    journal.record(kind, text, moment, stopId);
    refreshJournal();
  }

  function recordSample(rawNote) {
    const moment = getContext();
    if (!moment) return;
    const stopId = moment.atStop ? moment.focusStop.id : null;
    const note = journal.recordSample(rawNote, moment, stopId);
    refreshJournal();
    const where = stopId ? `na parada ${stopId}` : 'fora de parada';
    say(`Amostra registrada no diário ${where}, com ${fmtDuration(moment.elapsedH)} de saída.${note ? '' : ' Ficou sem observação: vale ditar uma antes de sair daqui.'}`);
  }

  function report(type, rawNote = '') {
    const moment = getContext();
    if (!moment) return;
    const { hazard, saved } = store.report({ type, note: rawNote, position: moment.position, outing: outingId, missionH: moment.elapsedH });
    if (!hazard) return;
    journal.record('perigo', `${HAZARD_TYPES[hazard.type]}${hazard.note ? `: ${hazard.note}` : ''}`, moment);
    refreshJournal();
    const kept = saved
      ? 'Fica guardado neste navegador e gera aviso nas próximas saídas.'
      : 'Não consegui gravar no armazenamento local: o relato vale só para esta saída.';
    say(`Relato registrado: ${HAZARD_TYPES[hazard.type].toLowerCase()}${hazard.note ? ` (“${hazard.note}”)` : ''} em ${fmtPosition(moment.position)}. ${kept}`);
  }

  function deleteHazard(id) {
    store.remove(id);
    markers.clear();
    refreshJournal();
  }

  function exportJournal() {
    if (!snapshot) return;
    const { plan } = host.session();
    downloadText(EXPORT_FILE, journalToText(`${MODE_TEXT[plan.mode]}, ${planSize(plan)}`, journal.entries(), store.list().map(describeHazard)));
  }

  // ---------- Gaveta ----------

  function openDrawer(tab, focusInput = false) {
    open = true;
    if (tab) panel.setTab(tab);
    host.onChange();
    updatePanel();
    if (focusInput) panel.chat.focusInput();
  }

  function closeDrawer(returnFocus = false) {
    if (!open) return;
    open = false;
    host.onChange();
    if (returnFocus) host.focusDrawerButton();
  }

  // As perguntas rápidas só são refeitas quando o momento da saída muda.
  function updatePanel() {
    const current = getContext();
    if (!open || !current) return;
    const protocol = current.guardiao.protocol;
    const key = `${protocol?.id ?? ''}|${protocol?.stepType ?? ''}|${current.atStop}|${current.target.kind}|${current.stopsReached}`;
    if (key !== quickKey) {
      quickKey = key;
      panel.chat.setQuickQuestions(assistant.examples(unifiedQuickQuestions(current)));
    }
    panel.science.update({
      stop: current.focusStop,
      atStop: current.atStop,
      paused: current.paused,
      statusText: scienceStatus(current),
      sampleCount: current.journal.samplesByStop[current.focusStop.id] ?? 0,
    });
  }

  // ---------- Ciclo de vida ----------

  function start(plan) {
    stops = describeStops(plan);
    journal = createJournal();
    outingId = newId();
    snapshot = null;
    context = null;
    located = [];
    open = false;
    greeted = false;
    quickKey = '';
    lineKey = null;
    saidAtS = new Map();
    seenProtocols = new Map();
    held = null;
    holding = true;
    lastRoutineS = -Infinity;
    acked.clear();
    assistant.reset();
    assistant.check();
    store.reload();
    markers.clear();
    panel.reset();
    refreshJournal();
    syncVoice();
  }

  function stop() {
    mic.stopListening();
    audio.silence();
  }

  function greet() {
    greeted = true;
    const { plan } = host.session();
    const first = plan.stops[0];
    const known = store.list().length;
    const reports = known ? ` Há ${known === 1 ? '1 perigo relatado' : `${known} perigos relatados`} guardados neste navegador: aviso quando você chegar perto.` : '';
    log('saida', `Início da saída: plano ${MODE_TEXT[plan.mode]}, ${planSize(plan)}.`);
    announce(`${assistant.intro()} Plano ${MODE_TEXT[plan.mode]}: ${planSize(plan)}, ${fmtKm(plan.stats.totalKm)}, cerca de ${fmtDuration(plan.stats.hours)}. Primeira parada: ${stopShortName(first.stop)}, a ${fmtDistance(first.distM)}.${safetyBriefing(plan)}${reports}`, 0);
  }

  /** Perigos relatados em volta da posição do quadro e o aviso de aproximação, se houver. */
  function warningAt(session) {
    const { r, pos } = session;
    located = locateHazards(store.list(), pos, r.heading, outingId);
    return r.finished || r.sheltered ? null : hazardWarning(located);
  }

  function onArrival(stop, conducting) {
    log('chegada', `Chegada: ${stop.name}.`, stop.id);
    say(`Chegamos à parada ${stop.id}, ${stopShortName(stop)}. Pergunta científica: ${stop.q} Tarefa: ${stop.task}${stop.risk ? ` Risco do local: ${stop.risk}.` : ''} Pausei a simulação para a coleta: a lista de verificação está na aba Ciência.`);
    // Com um protocolo em curso, a conversa fica na frente: os passos não podem sumir da tela.
    openDrawer(conducting ? 'chat' : 'science');
  }

  // Protocolos que abriram, fecharam ou foram cumpridos desde o quadro anterior vão para o diário.
  // A comparação é com o que este módulo viu por último: um passo pode ser confirmado entre dois quadros.
  function logProtocols(session) {
    const now = new Map(session.protocols.map((instance) => [instance.id, instance]));
    for (const [id, instance] of now) {
      const { name } = PROTOCOLS[id];
      if (!seenProtocols.has(id)) {
        log('emergencia', `Protocolo aberto: ${name}.`);
      } else if (instance.done && !seenProtocols.get(id).done) {
        if (instance.decision === 'seguir') {
          log('emergencia', `Decisão no protocolo “${name}”: seguir a missão.`);
        } else {
          log('emergencia', `Protocolo cumprido: ${name}.`);
          say(`Protocolo cumprido: “${name}”. Os passos são proposta do protótipo, não procedimento oficial da NASA. Sigo vigiando os alertas.`);
        }
      }
    }
    for (const id of seenProtocols.keys()) {
      if (!now.has(id)) log('emergencia', `Condição encerrada: ${PROTOCOLS[id].name}.`);
    }
    seenProtocols = now;
  }

  // A frase do momento. O passo de um protocolo é sempre dito; aviso e alerta respeitam o intervalo
  // de repetição, e o aviso preventivo só ocupa a linha nos primeiros segundos depois de dito.
  function currentLine(message, instruction) {
    const isStep = message.key.startsWith('p:');
    const isAdvice = message.key.startsWith('aviso:');
    const due = clockS - (saidAtS.get(message.key) ?? -Infinity) >= REPEAT_COOLDOWN_S;
    const line = voiceLine(message, instruction, isAdvice && !due ? clockS - saidAtS.get(message.key) : 0);
    if (line.key === lineKey && !(isAdvice && due)) return line;
    lineKey = line.key;
    if (line.logged && (isStep || due)) {
      saidAtS.set(message.key, clockS);
      announce(plainText(line.text), line.priority);
    } else if (!line.logged && !isMicOpen() && clockS - lastRoutineS >= ROUTINE_SPEECH_GAP_S) {
      lastRoutineS = clockS;
      audio.speak(line.text, line.priority);
    }
    return line;
  }

  /**
   * Um quadro. `view` traz o estado do quadro: sessão de antes e de agora, protocolo em condução,
   * alertas (com o perigo relatado), a frase do Guardião (`assistantMessage`), a instrução de rota
   * do Navegador (ou null) e o rádio à frente.
   * @returns {{ text: string, kind: 'guia'|'aviso'|'resposta' }} O que a linha do assistente mostra.
   */
  function frame(dtS, { before, session, proto, alerts, message, instruction, radio, arrivedAt }) {
    // Os cartões fixados pela IA se atualizam duas vezes por segundo.
    pinsWaitS -= dtS;
    if (pinsWaitS <= 0) { pinsWaitS = PINS_REFRESH_S; renderPins(assistant.pins()); }
    clockS += dtS;
    // O contexto do assistente é montado sob demanda a partir deste retrato do quadro.
    const guidance = { text: (instruction ?? message).text, radio: session.r.finished ? null : radio.ahead };
    snapshot = { alerts, guidance };
    context = null;
    if (!greeted) greet();

    logProtocols(session);
    if (arrivedAt) onArrival(arrivedAt, Boolean(proto));
    // Fim da coleta seguindo o plano (sair para um abrigo no meio de uma emergência não conta).
    const ended = before.state.dwellRemainingH > 0 && session.state.dwellRemainingH === 0 && session.state.nav.kind === 'plan';
    const leftStop = ended ? session.plan.stops[session.state.stopsReached - 1]?.stop : null;
    if (leftStop && !journal.stats().samplesByStop[leftStop.id]) {
      say(`Saímos da parada ${leftStop.id} sem amostra registrada no diário. Se coletou algo, diga “registrar amostra” e a observação.`, 'alert');
    }
    const line = currentLine(message, instruction);

    markers.render(located);
    panelWaitS += dtS;
    if (panelWaitS >= PANEL_INTERVAL_S) {
      panelWaitS = 0;
      updatePanel();
    }

    // Perigo, emergência e passo de protocolo tomam a linha de volta na hora.
    if (held && (clockS >= held.untilS || line.priority >= ANSWER_PRIORITY)) held = null;
    if (held) return { text: held.text, kind: 'resposta' };
    return { text: line.text, kind: line.key.startsWith('guia:') ? 'guia' : 'aviso' };
  }

  return Object.freeze({
    start,
    stop,
    frame,
    warningAt,
    acked,
    report,
    openDrawer,
    closeDrawer,
    isOpen: () => open,
    /** A sessão mudou por uma ação do usuário: o contexto do assistente é refeito na próxima consulta. */
    invalidate: () => { context = null; },
    toggleVoice: () => conversation.toggleSpeaking(),
    listen: () => listenTo('chat'),
    voiceState: () => conversation.voiceState(),
    /** Texto do rótulo do assistente: qual IA está respondendo, ou que ela está fora do ar. */
    assistantNote: () => assistant.note(),
  });
}
