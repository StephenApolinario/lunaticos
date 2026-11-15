// Visor "cientista": o visor como parceiro de campo. Um assistente conversa com o
// astronauta, conduz a ciência das paradas e os protocolos de emergência, e guarda os
// perigos relatados para as próximas saídas. Segue o contrato de ../LEIA-ME.md.
//
// Este arquivo é só a cola: liga a simulação, o HUD e as peças independentes
// (conversa.js, assistente.js, diario.js, perigos.js, marcadores.js, voz.js, painel.js).
//
// Real: posição, distância, declive e altitude (rotas sobre o DEM do USGS), a segurança
// calculada sobre o relevo (context.safety) e os textos das paradas. Simulado: traje,
// radiação, temperatura, emergências dos botões e o assistente, que funciona por regras.

import { createSimState, patchState, advance, jumpTo, deriveReadout } from '../../src/simulation.js';
import { samplePath } from '../../src/route.js';
import { fmtDistance, fmtDuration, fmtKm } from '../../src/format.js';
import { h, setText } from '../../src/dom.js';
import { t } from '../../src/i18n.js';
import { createHud, renderHud, setData } from './hud.js';
import { createSceneMarkers } from './marcadores.js';
import { createCameraRig } from './camera.js';
import { createPanel } from './painel.js';
import { createVoice } from './voz.js';
import { createConversation } from './conversa.js';
import { quickQuestions } from './assistente.js';
import { buildContext, describeStops, stopShortName } from './contexto.js';
import {
  EMERGENCIES, PROTOCOL_BY_ALERT, bindProtocols, protocolStepCount, protocolStepText, protocolIntroText, protocolEvidenceText,
} from './protocolos.js';
import { createJournal, journalToText, downloadText, fmtPosition, EXPORT_FILE } from './diario.js';
import { HAZARD_TYPES, createHazardStore, describeHazard, newId } from './perigos.js';

const SCRUB_MAX = 1000;
const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const MODE_TEXT = Object.freeze({ walk: t`a pé`, car: t`de veículo` });
const NO_EMERGENCY = Object.freeze({ storm: false, radio: false, o2: false });
// Um mesmo alerta só volta a ser comentado depois deste intervalo (segundos reais).
const COMMENT_COOLDOWN_S = 25;
// A busca do abrigo de relevo mais próximo só é refeita depois de andar esta distância.
const SHELTER_REFRESH_M = 25;
const SHELTER_MARKER_MAX_M = 600;

/**
 * @param {{
 *   mount: HTMLElement, stageElement: HTMLElement, camera: import('three').PerspectiveCamera,
 *   terrain: { probe: (x: number, z: number) => object, heightAt: (x: number, z: number) => number },
 *   overlays: { setNextStop: (id: string|null, label: string) => void },
 *   onExit: () => void,
 *   safety: { walkBackAt: Function, nearestShelter: Function, protocolFor: Function, assumptions: object },
 * }} deps
 */
export function createVisor({ mount, stageElement, camera, terrain, overlays, onExit, safety }) {
  const els = createHud(mount);
  const protocols = bindProtocols(safety.protocolFor);
  const markers = createSceneMarkers(els.markers, camera, terrain);
  const hazardStore = createHazardStore();
  const emergencyButtons = {};

  let plan = null;
  let stops = [];
  let state = createSimState();
  let active = false;
  let emergencies = NO_EMERGENCY;
  let protocol = null;
  // Protocolos já conduzidos enquanto a emergência dura (para não recomeçar a cada quadro).
  let conducted = new Set();
  let journal = createJournal();
  let outingId = '';
  let context = null;
  let activeAlertKeys = new Set();
  let commentedAtS = new Map();
  let panelOpen = false;
  let shelterCache = null;
  let finishAnnounced = false;
  let scrubbing = false;
  let quickKey = '';

  const rig = createCameraRig(camera, stageElement, () => active);
  const panel = createPanel(els.panel, {
    onAsk: (question) => conversation.ask(question),
    onMic: listenTo,
    onVoiceToggle: () => conversation.toggleSpeaking(),
    onRecordSample: recordSample,
    onContinue: () => setPaused(false),
    onSuggest: () => { openPanel('chat'); conversation.ask(t`O que observar aqui?`); },
    onExport: exportJournal,
    onDeleteHazard: deleteHazard,
    onClose: () => closePanel(true),
  });
  const conversation = createConversation({
    getContext: () => context,
    onMessage: showMessage,
    onAction: runAction,
    voice: createVoice(),
    onVoiceChange: syncVoice,
  });
  const { say } = conversation;

  // ---------- Painel, popovers e controles ----------

  function openPanel(tab, focusInput = false) {
    panelOpen = true;
    els.panel.hidden = false;
    setData(els.root, 'panel', 'open');
    els.panelButton.setAttribute('aria-expanded', 'true');
    if (tab) panel.setTab(tab);
    updatePanel();
    if (focusInput) panel.chat.focusInput();
  }

  function closePanel(returnFocus = false) {
    panelOpen = false;
    els.panel.hidden = true;
    setData(els.root, 'panel', 'closed');
    els.panelButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) els.panelButton.focus();
  }

  /** @returns {boolean} true se havia um menu aberto. */
  function closePopovers() {
    const wasOpen = !els.popHazard.hidden || !els.popEmergency.hidden;
    els.popHazard.hidden = true;
    els.popEmergency.hidden = true;
    els.hazardButton.setAttribute('aria-expanded', 'false');
    els.emergencyButton.setAttribute('aria-expanded', 'false');
    return wasOpen;
  }

  function togglePopover(popover, trigger) {
    const willOpen = popover.hidden;
    closePopovers();
    if (!willOpen) return;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    popover.querySelector('button')?.focus();
  }

  function buildPopovers() {
    els.popHazard.append(
      h('p', { class: 'cientista-pop-title' }, t`Relatar perigo aqui`),
      ...Object.entries(HAZARD_TYPES).map(([type, label]) => h('button', {
        type: 'button', dataset: { type }, onclick: () => { closePopovers(); els.hazardButton.focus(); reportHazard(type); },
      }, label)),
      h('p', { class: 'cientista-fine' }, t`Fica guardado neste navegador e avisa nas próximas saídas.`),
    );
    els.popEmergency.append(
      h('p', { class: 'cientista-pop-title' }, `${t`Emergências`} `, h('small', {}, t`simuladas`)),
      ...Object.entries(EMERGENCIES).map(([id, emergency]) => {
        emergencyButtons[id] = h('button', {
          type: 'button', 'aria-pressed': 'false', onclick: () => { closePopovers(); els.emergencyButton.focus(); toggleEmergency(id); },
        }, emergency.label);
        return emergencyButtons[id];
      }),
      h('p', { class: 'cientista-fine' }, t`Para a demonstração: liga a condição e o assistente conduz o protocolo.`),
    );
  }

  const emergencyOn = (id) => (id === 'solar' ? state.solarEvent : emergencies[id]);

  function syncControls() {
    // O rótulo já diz o estado; aria-pressed junto com rótulo que muda seria contraditório.
    setText(els.pause, state.paused ? t`Continuar` : t`Pausar`);
    setData(els.pause, 'active', String(state.paused));
    els.speed.value = String(state.speed);
    setData(els.emergencyButton, 'active', String(Object.keys(EMERGENCIES).some(emergencyOn)));
    for (const [id, node] of Object.entries(emergencyButtons)) node.setAttribute('aria-pressed', String(emergencyOn(id)));
  }

  function syncVoice(voiceState = conversation.voiceState()) {
    panel.setVoiceState(voiceState);
    els.stripMic.hidden = !voiceState.canListen;
    setText(els.stripMic, voiceState.listening === 'chat' ? t`Ouvindo…` : t`Falar`);
    els.stripMic.setAttribute('aria-pressed', String(voiceState.listening === 'chat'));
  }

  function setPaused(paused) {
    state = patchState(state, { paused });
    syncControls();
  }

  // ---------- Conversa ----------

  // Cada fala vai para o histórico; as do assistente também aparecem na faixa do HUD.
  function showMessage(message) {
    panel.chat.addMessage(message);
    if (message.from === 'user') return;
    setText(els.stripText, message.text);
    setData(els.strip, 'kind', message.from);
  }

  // O que foi ditado na conversa vira pergunta; na observação da amostra, vira texto do campo.
  function listenTo(target) {
    conversation.listen(target, target === 'note' ? (text) => panel.science.appendNote(text) : (text) => conversation.ask(text));
  }

  const ACTIONS = Object.freeze({
    'report-hazard': (action) => reportHazard(action.hazardType, action.note),
    'record-sample': (action) => recordSample(action.note),
    'protocol-advance': () => advanceProtocol(),
    'protocol-end': () => endProtocol(),
    pause: () => { setPaused(true); say(t`Simulação pausada.`); },
    resume: () => { setPaused(false); say(t`Simulação retomada.`); },
  });

  // A ação vem do motor do assistente (amanhã, de um modelo): só roda se for conhecida.
  function runAction(action) {
    if (Object.hasOwn(ACTIONS, action.type)) ACTIONS[action.type](action);
  }

  // ---------- Diário, amostras e perigos ----------

  function logEntry(kind, text, stopId = null) {
    journal.record(kind, text, context, stopId);
    refreshJournal();
  }

  function refreshJournal() {
    panel.journal.render(journal.entries(), hazardStore.list(), outingId);
  }

  function recordSample(rawNote) {
    if (!context) return;
    const stopId = context.atStop ? context.focusStop.id : null;
    const note = journal.recordSample(rawNote, context, stopId);
    refreshJournal();
    refreshContext();
    updatePanel();
    const elapsed = fmtDuration(context.elapsedH);
    const logged = stopId
      ? t`Amostra registrada no diário na parada ${stopId}, com ${elapsed} de saída.`
      : t`Amostra registrada no diário fora de parada, com ${elapsed} de saída.`;
    say(note ? logged : `${logged} ${t`Ficou sem observação: vale ditar uma antes de sair daqui.`}`);
  }

  function reportHazard(type, rawNote = '') {
    if (!context) return;
    const { hazard, saved } = hazardStore.report({ type, note: rawNote, position: context.position, outing: outingId, missionH: context.elapsedH });
    if (!hazard) return;
    logEntry('perigo', `${HAZARD_TYPES[type]}${hazard.note ? `: ${hazard.note}` : ''}`);
    refreshContext();
    const kept = saved
      ? t`Fica guardado neste navegador e gera aviso nas próximas saídas.`
      : t`Não consegui gravar no armazenamento local: o relato vale só para esta saída.`;
    const what = HAZARD_TYPES[type].toLowerCase();
    const where = fmtPosition(context.position);
    const logged = hazard.note ? t`Relato registrado: ${what} (“${hazard.note}”) em ${where}.` : t`Relato registrado: ${what} em ${where}.`;
    say(`${logged} ${kept}`);
  }

  function deleteHazard(id) {
    hazardStore.remove(id);
    markers.clear();
    refreshJournal();
  }

  const planSize = () => {
    if (plan.isCustom) return t`rota livre com pontos escolhidos no mapa`;
    return plan.stopCount === 1 ? t`1 parada` : t`${plan.stopCount} paradas`;
  };
  // "a pé, 3 paradas": o plano em poucas palavras, para o diário.
  const planLabel = () => `${MODE_TEXT[plan.mode]}, ${planSize()}`;

  function exportJournal() {
    const text = journalToText(planLabel(), journal.entries(), hazardStore.list().map(describeHazard));
    downloadText(EXPORT_FILE, text);
  }

  // ---------- Emergências e protocolos ----------

  const emergencyName = (id) => EMERGENCIES[id].label.toLowerCase();

  function toggleEmergency(id) {
    if (!context) return;
    const on = !emergencyOn(id);
    if (id === 'solar') state = patchState(state, { solarEvent: on });
    else emergencies = Object.freeze({ ...emergencies, [id]: on });
    logEntry('emergencia', on ? t`Início da emergência simulada: ${emergencyName(id)}.` : t`Fim da emergência simulada: ${emergencyName(id)}.`);
    if (!on) {
      if (protocol?.id === id) protocol = null;
      say(t`Fim da simulação de ${emergencyName(id)}.`);
    }
    refreshContext();
    syncControls();
  }

  function startProtocol(id) {
    protocol = Object.freeze({ id, step: 0 });
    conducted.add(id);
    refreshContext();
    say(protocolIntroText(protocol, context), 'alert');
    openPanel('chat');
  }

  function advanceProtocol() {
    if (!protocol) return;
    const { id } = protocol;
    const last = protocol.step + 1 >= protocolStepCount(protocol, context);
    protocol = last ? null : Object.freeze({ ...protocol, step: protocol.step + 1 });
    refreshContext();
    if (last) say(t`Protocolo de ${emergencyName(id)} concluído. Base do protocolo: ${protocolEvidenceText(id, context)} Sigo acompanhando os alertas.`);
    else say(protocolStepText(protocol, context), 'alert');
  }

  function endProtocol() {
    if (!protocol) {
      say(t`Não há protocolo de emergência em andamento.`);
      return;
    }
    const { id } = protocol;
    protocol = null;
    if (emergencyOn(id)) {
      toggleEmergency(id);
      return;
    }
    refreshContext();
    say(t`Protocolo de ${emergencyName(id)} encerrado. A condição que o disparou continua nos alertas.`);
  }

  // Comenta cada alerta quando ele aparece: o que é e o que fazer. Emergências falam pelo
  // protocolo: um por vez, e as que chegam junto esperam a vez na ordem de severidade.
  function reactToAlerts() {
    const kinds = new Set(context.alerts.map((alert) => alert.kind));
    const nowS = performance.now() / 1000;
    for (const alert of context.alerts) {
      if (activeAlertKeys.has(alert.key) || PROTOCOL_BY_ALERT[alert.kind]) continue;
      if (nowS - (commentedAtS.get(alert.key) ?? -Infinity) < COMMENT_COOLDOWN_S) continue;
      commentedAtS.set(alert.key, nowS);
      say(t`Alerta: ${alert.text}. ${alert.action}`, 'alert');
    }
    activeAlertKeys = new Set(context.alerts.map((alert) => alert.key));

    // Emergência que saiu dos alertas pode ter o protocolo conduzido de novo se voltar.
    for (const id of conducted) {
      if (!kinds.has(EMERGENCIES[id].alert)) conducted.delete(id);
    }
    if (protocol && !kinds.has(EMERGENCIES[protocol.id].alert)) {
      const { id } = protocol;
      protocol = null;
      say(t`Protocolo de ${emergencyName(id)} interrompido: a condição saiu dos alertas.`);
    }
    if (protocol) return;
    const waiting = context.alerts.find((alert) => PROTOCOL_BY_ALERT[alert.kind] && !conducted.has(PROTOCOL_BY_ALERT[alert.kind]));
    if (waiting) startProtocol(PROTOCOL_BY_ALERT[waiting.kind]);
  }

  // ---------- Paradas ----------

  function announceArrival(stop) {
    logEntry('chegada', t`Chegada: ${stop.name}.`, stop.id);
    const arrival = t`Chegamos à parada ${stop.id}, ${stopShortName(stop)}, capítulo “${stop.ch}”. Pergunta científica: ${stop.q} Tarefa: ${stop.task}`;
    const risk = stop.risk ? ` ${t`Risco do local: ${stop.risk}.`}` : '';
    say(`${arrival}${risk} ${t`Pausei a simulação para a coleta: a lista de verificação está na aba Ciência.`}`);
    // Com um protocolo em curso, a conversa fica na frente: os passos não podem sumir da tela.
    openPanel(protocol ? 'chat' : 'science');
  }

  function scienceStatus() {
    const { target } = context;
    if (context.finished) return t`Saída concluída · de volta ao habitat`;
    if (context.atStop) return context.paused ? t`Em coleta · simulação pausada para o registro` : t`Em coleta · faltam ${fmtDuration(target.etaH)}`;
    if (target.kind === 'return') return t`Retorno · habitat a ${fmtDistance(target.distM)}`;
    return t`Próxima parada · ${fmtDistance(target.distM)} · chegada em ${fmtDuration(target.etaH)}`;
  }

  // Só trabalha com o painel aberto; as perguntas rápidas só são refeitas quando o momento muda.
  function updatePanel() {
    if (!panelOpen || !context) return;
    const key = `${context.protocol?.id ?? ''}|${context.atStop}|${context.target.kind}|${context.stopsReached}`;
    if (key !== quickKey) {
      quickKey = key;
      panel.chat.setQuickQuestions(quickQuestions(context));
    }
    panel.science.update({
      stop: context.focusStop,
      atStop: context.atStop,
      paused: context.paused,
      statusText: scienceStatus(),
      sampleCount: context.journal.samplesByStop[context.focusStop.id] ?? 0,
    });
  }

  // ---------- Ciclo de vida ----------

  // Proteção de relevo mais próxima (estimativa de context.safety), refeita só quando se anda.
  function shelterNear(here) {
    if (!shelterCache || Math.hypot(here.x - shelterCache.x, here.z - shelterCache.z) > SHELTER_REFRESH_M) {
      const site = safety.nearestShelter(here.x, here.z).terrain;
      shelterCache = {
        x: here.x,
        z: here.z,
        shelter: Object.freeze({ terrain: site ? { x: site.x, z: site.z, distM: site.distM, walkH: site.walkH, skyBlocked: site.skyBlocked } : null }),
      };
    }
    return shelterCache.shelter;
  }

  function refreshContext() {
    const here = samplePath(plan.path, state.distM);
    const ground = terrain.probe(here.x, here.z);
    const readout = deriveReadout(plan, state, ground);
    context = buildContext({
      plan, stops, state, readout, emergencies, hazards: hazardStore.list(), outingId, journal: journal.stats(), protocol,
      protocols, assumptions: safety.assumptions, walkBackH: safety.walkBackAt(here.x, here.z), shelter: shelterNear(here),
    });
    return { readout, ground };
  }

  // Em evento solar, a proteção de relevo indicada entra na cena junto com os perigos relatados.
  function sceneMarkers() {
    const site = context.shelter.terrain;
    if (!context.emergencies.solar || !site || site.distM > SHELTER_MARKER_MAX_M) return context.hazards.list;
    return [{ id: 'abrigo-relevo', type: 'abrigo', x: site.x, z: site.z, label: t`Proteção de relevo (estimativa)`, distM: site.distM }, ...context.hazards.list];
  }

  // Resumo de segurança do plano, calculado sobre o relevo real (plan.safety).
  function safetyBriefing() {
    const assessed = plan.safety;
    if (!assessed) return '';
    const gaps = assessed.commsGaps.length;
    const lostM = fmtDistance(assessed.commsLostM);
    let comms = t`há linha de visada de rádio com o habitat em toda a rota`;
    if (gaps === 1) comms = t`${lostM} da rota ficam sem linha de visada de rádio com o habitat, em 1 trecho`;
    else if (gaps) comms = t`${lostM} da rota ficam sem linha de visada de rádio com o habitat, em ${gaps} trechos`;
    const noReturn = assessed.noReturn
      ? t`o ponto sem volta a pé fica a ${fmtDistance(assessed.noReturn.distM)} do início`
      : t`não há ponto sem volta a pé`;
    return ` ${t`Segurança do plano, pelo relevo real (antenas e reserva de O₂ são hipóteses da equipe): ${comms}; ${noReturn}.`}`;
  }

  function start(nextPlan) {
    plan = nextPlan;
    stops = describeStops(plan);
    state = createSimState();
    emergencies = NO_EMERGENCY;
    protocol = null;
    conducted = new Set();
    journal = createJournal();
    outingId = newId();
    activeAlertKeys = new Set();
    commentedAtS = new Map();
    shelterCache = null;
    finishAnnounced = false;
    scrubbing = false;
    quickKey = '';
    const known = hazardStore.reload().length;
    markers.clear();
    panel.reset();
    closePopovers();
    closePanel();
    rig.reset(plan, terrain);
    active = true;
    mount.hidden = false;
    refreshContext();
    syncControls();
    syncVoice();

    const first = plan.stops[0];
    let reports = '';
    if (known === 1) reports = ` ${t`Há 1 perigo relatado em saídas anteriores: aviso quando você chegar perto.`}`;
    else if (known) reports = ` ${t`Há ${known} perigos relatados em saídas anteriores: aviso quando você chegar perto.`}`;
    logEntry('saida', t`Início da saída: plano ${planLabel()}.`);
    const totalKm = fmtKm(plan.stats.totalKm);
    const hours = fmtDuration(plan.stats.hours);
    const ready = t`Assistente de campo pronto. Sou simulado por regras e respondo só com os dados desta saída.`;
    const summary = plan.mode === 'walk'
      ? t`Plano a pé: ${planSize()}, ${totalKm}, cerca de ${hours}.`
      : t`Plano de veículo: ${planSize()}, ${totalKm}, cerca de ${hours}.`;
    const firstStop = t`Primeira parada: ${stopShortName(first.stop)}, a ${fmtDistance(first.distM)}.`;
    say(`${ready} ${summary} ${firstStop}${safetyBriefing()}${reports}`);
    // O painel do tablet some nesta tela: o foco vai para o primeiro controle do visor.
    els.pause.focus();
  }

  function stop() {
    active = false;
    mount.hidden = true;
    overlays.setNextStop(null, '');
    conversation.stop();
  }

  function syncScrub() {
    // Enquanto a pessoa segura a barra, quem manda no valor é ela.
    if (scrubbing) return;
    const value = String(Math.round((state.distM / plan.path.totalM) * SCRUB_MAX));
    if (els.scrub.value !== value) els.scrub.value = value;
  }

  function frame(dtS) {
    if (!active || !plan) return;
    const before = state;
    state = advance(plan, state, dtS);
    // Ao chegar, a simulação pausa: a coleta leva o tempo que o astronauta precisar.
    const arrived = state.stopsReached > before.stopsReached && state.dwellRemainingH > 0;
    if (arrived) state = patchState(state, { paused: true });
    const leftStop = before.dwellRemainingH > 0 && state.dwellRemainingH === 0 ? plan.stops[state.stopsReached - 1]?.stop ?? null : null;
    if (state.finished !== before.finished || state.paused !== before.paused) syncControls();

    const { readout, ground } = refreshContext();
    const viewHeading = rig.apply(readout, ground, state, dtS);
    renderHud(els, context, viewHeading, readout.targetBearing);
    markers.render(sceneMarkers());
    updatePanel();
    syncScrub();

    const { target } = readout;
    overlays.setNextStop(target.stop.id, target.kind === 'dwell' ? target.name : `${target.name} · ${fmtDistance(target.distM)}`);

    if (arrived) announceArrival(plan.stops[state.stopsReached - 1].stop);
    if (leftStop && !context.journal.samplesByStop[leftStop.id]) {
      say(t`Saímos da parada ${leftStop.id} sem amostra registrada no diário. Se coletou algo, diga “registrar amostra” e a observação.`, 'alert');
    }
    // O fim pode chegar andando ou pela barra de posição: nos dois casos é anunciado uma vez.
    if (state.finished && !finishAnnounced) say(t`Travessia concluída: você está de volta ao habitat. O diário da saída está pronto para exportar.`);
    finishAnnounced = state.finished;
    reactToAlerts();
  }

  // ---------- Eventos ----------

  buildPopovers();
  els.scrub.max = String(SCRUB_MAX);
  els.pause.addEventListener('click', () => setPaused(!state.paused));
  els.speed.addEventListener('change', () => { state = patchState(state, { speed: Number(els.speed.value) }); });
  els.exit.addEventListener('click', onExit);
  els.scrub.addEventListener('input', () => {
    if (!plan) return;
    state = jumpTo(plan, state, (Number(els.scrub.value) / SCRUB_MAX) * plan.path.totalM);
    syncControls();
  });
  els.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { scrubbing = false; });
  els.hazardButton.addEventListener('click', () => togglePopover(els.popHazard, els.hazardButton));
  els.emergencyButton.addEventListener('click', () => togglePopover(els.popEmergency, els.emergencyButton));
  els.panelButton.addEventListener('click', () => (panelOpen ? closePanel() : openPanel(null, !matchMedia('(pointer: coarse)').matches)));
  els.stripOpen.addEventListener('click', () => openPanel('chat', true));
  els.stripMic.addEventListener('click', () => listenTo('chat'));

  stageElement.addEventListener('pointerdown', (event) => {
    if (active && !event.target.closest('.cientista-pop, #cientista-hazard-btn, #cientista-emergency-btn')) closePopovers();
  });

  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      // Esc fecha primeiro o que estiver aberto; só então volta ao tablet.
      if (closePopovers()) return;
      if (panelOpen) closePanel(true);
      else onExit();
      return;
    }
    // Digitar no campo do assistente ou na observação não dispara atalho.
    const tag = event.target.tagName;
    if (TYPING_TAGS.has(tag)) return;
    if (event.key === '/') {
      event.preventDefault();
      openPanel('chat', true);
    }
    // Em um botão, a barra de espaço já aciona o próprio botão.
    if (event.key === ' ' && tag !== 'BUTTON') {
      event.preventDefault();
      setPaused(!state.paused);
    }
  });

  return Object.freeze({ start, stop, frame });
}
