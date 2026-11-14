// Exemplo de integração: as peças do visor cientista fora do HUD dele.
// Só usa lógica pura (assistente, conversa, diário, perigos) e duas telas de painel.js.
// Não carrega o mapa 3D nem context.safety: o contexto vem de um ponto fixo da rota a pé.

import { buildPlan } from '../../src/route.js';
import { createSimState, jumpTo, deriveReadout } from '../../src/simulation.js';
import { protocolFor } from '../../data/protocolos.js';
import { quickQuestions } from './assistente.js';
import { buildContext, describeStops } from './contexto.js';
import { bindProtocols } from './protocolos.js';
import { createConversation } from './conversa.js';
import { createJournal } from './diario.js';
import { HAZARD_TYPES, createHazardStore } from './perigos.js';
import { createChatView, createJournalView } from './painel.js';

const POSITION_M = 400;
const GROUND = Object.freeze({ radiation: 27, groundTemp: -20 });
const ASSUMPTIONS = Object.freeze({ habitatMastM: 10, suitAntennaM: 2, o2ReservePct: 10 });
const OUTING = 'exemplo';

// Armazenamento em memória: mostra que o relato de perigos recebe o dele por parâmetro.
const memory = new Map();
const hazardStore = createHazardStore({ getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) });
const journal = createJournal();
const plan = buildPlan('walk', false);
const stops = describeStops(plan);
const state = jumpTo(plan, createSimState(), POSITION_M);
const protocols = bindProtocols(protocolFor);

// Sem context.safety aqui: a volta ao habitat sai pela rota e não há abrigo de relevo.
const getContext = () => buildContext({
  plan, stops, state, readout: deriveReadout(plan, state, GROUND),
  emergencies: { storm: false, radio: false, o2: false },
  hazards: hazardStore.list(), outingId: OUTING, journal: journal.stats(),
  protocol: null, protocols, assumptions: ASSUMPTIONS, walkBackH: undefined, shelter: null,
});

const chat = createChatView({ onAsk: (question) => conversation.ask(question), onMic: () => {} });
const journalView = createJournalView({ onExport: () => {}, onDeleteHazard: (id) => { hazardStore.remove(id); refresh(); } });
const refresh = () => journalView.render(journal.entries(), hazardStore.list(), OUTING);

// Os comandos reconhecidos voltam para quem hospeda: aqui, só os dois que estas peças cobrem.
const ACTIONS = Object.freeze({
  'report-hazard': ({ hazardType, note }) => {
    const context = getContext();
    const { hazard } = hazardStore.report({ type: hazardType, note, position: context.position, outing: OUTING, missionH: context.elapsedH });
    if (!hazard) return;
    journal.record('perigo', HAZARD_TYPES[hazard.type], context);
    conversation.say(`Relato registrado: ${HAZARD_TYPES[hazard.type].toLowerCase()}.`);
  },
  'record-sample': ({ note }) => {
    journal.recordSample(note, getContext());
    conversation.say('Amostra registrada no diário.');
  },
});

const conversation = createConversation({
  getContext,
  onMessage: (message) => chat.addMessage(message),
  onAction: (action) => {
    if (!Object.hasOwn(ACTIONS, action.type)) return;
    ACTIONS[action.type](action);
    refresh();
  },
});

document.getElementById('exemplo-grid').append(chat.element, journalView.element);
chat.setQuickQuestions(quickQuestions(getContext()));
refresh();
conversation.say('Assistente pronto, fora do HUD. Sou simulado por regras.');
