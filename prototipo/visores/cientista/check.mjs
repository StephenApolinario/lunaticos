// Confere, sem navegador, as peças que funcionam sozinhas: o motor do assistente, a
// conversa, o diário e o relato de perigos, contra a rota real.
//   node prototipo/visores/cientista/check.mjs

import assert from 'node:assert/strict';
import { buildPlan, samplePath, registerStop } from '../../src/route.js';
import { createSimState, jumpTo, patchState, deriveReadout } from '../../src/simulation.js';
import { STOP_HOURS } from '../../data/travessia.js';
import { protocolFor } from '../../data/protocolos.js';
import { buildContext, describeStops } from './contexto.js';
import { answerByRules, askAssistant, quickQuestions } from './assistente.js';
import { bindProtocols } from './protocolos.js';
import { createConversation } from './conversa.js';
import { createJournal, journalToText } from './diario.js';
import { createHazardStore, describeHazard, locateHazards, hazardWarning, HAZARD_STORAGE_KEY } from './perigos.js';
import { toSpeech } from './voz.js';

const GROUND = { radiation: 27, groundTemp: -20 };
// Avaliação de segurança de mentira, no formato de plan.safety (a real precisa do relevo carregado).
const SAFETY = { noReturn: { distM: 3000 }, commsGaps: [{ fromM: 600, toM: 700 }], commsLostM: 100 };
const plan = { ...buildPlan('walk', false), safety: SAFETY };
const stops = describeStops(plan);
const journal = createJournal();
const protocols = bindProtocols(protocolFor);
const ASSUMPTIONS = { habitatMastM: 10, suitAntennaM: 2, o2ReservePct: 10 };
const SHELTER = { terrain: { x: 0, z: 0, distM: 320, walkH: 0.13, skyBlocked: 0.35 } };

// Armazenamento de mentira: o relato de perigos recebe o dele por parâmetro.
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

function contextAt(distM, extra = {}) {
  const usedPlan = extra.plan ?? plan;
  const state = patchState(jumpTo(usedPlan, createSimState(), distM), extra.state ?? {});
  return buildContext({
    plan: usedPlan, stops: extra.plan ? describeStops(usedPlan) : stops, state, readout: deriveReadout(usedPlan, state, GROUND),
    emergencies: { storm: false, radio: false, o2: false, ...extra.emergencies },
    hazards: extra.hazards ?? [],
    outingId: 'teste',
    journal: journal.stats(),
    protocol: extra.protocol ?? null,
    protocols,
    assumptions: ASSUMPTIONS,
    walkBackH: extra.walkBackH ?? samplePath(usedPlan.path, distM).travelH,
    shelter: SHELTER,
    alerts: extra.alerts,
  });
}

const walking = contextAt(400);
const atStop = contextAt(plan.stops[0].distM, { state: { stopsReached: 1, dwellRemainingH: STOP_HOURS, paused: true } });
const intentOf = (question, context = walking) => answerByRules(question, context).intent;

// ---------- Assistente: pergunta → intenção, em caminhada e em parada ----------
const CASES = [
  ['Quanto falta?', 'quanto-falta'],
  ['Quanto falta para o habitat?', 'quanto-falta'],
  ['É seguro continuar?', 'seguranca'],
  ['Por que esta parada importa?', 'importancia'],
  ['Qual é a tarefa aqui?', 'tarefa'],
  ['Quanto oxigênio sobra na volta?', 'oxigenio'],
  ['Onde fica o abrigo mais próximo?', 'abrigo'],
  ['Como está a bateria?', 'bateria'],
  ['Qual a radiação agora?', 'radiacao'],
  ['Está muito frio?', 'temperatura'],
  ['Como está o declive à frente?', 'terreno'],
  ['Qual a minha altitude?', 'altitude'],
  ['O que observar aqui?', 'observar'],
  ['Qual é a pergunta científica?', 'pergunta-cientifica'],
  ['Quais perigos foram relatados?', 'perigos'],
  ['Quantas amostras registrei?', 'diario'],
  ['Fale sobre o enxofre', 'parada'],
  ['Que horas são?', 'tempo'],
  ['Qual é o plano?', 'rota'],
  ['Resumo da situação', 'resumo'],
  ['O que fazer numa tempestade de poeira?', 'protocolo'],
  ['O rádio está funcionando?', 'comunicacao'],
  ['Você é uma IA?', 'identidade'],
  ['Onde fica o ponto sem volta?', 'sem-volta'],
  ['Qual a fonte do protocolo de evento solar?', 'fonte'],
  ['Qual a previsão para amanhã?', 'previsao'],
  ['Quem ganhou a copa de 1970?', 'desconhecido'],
  ['relatar perigo areia fofa', 'relatar-perigo'],
  ['registrar amostra: veio amarelo no contato', 'registrar-amostra'],
  ['pausar', 'pausar'],
];

for (const [question, expected] of CASES) {
  for (const context of [walking, atStop]) {
    const reply = answerByRules(question, context);
    assert.equal(reply.intent, expected, `"${question}" caiu em ${reply.intent}, esperado ${expected}`);
    assert.ok(reply.text || reply.action, `"${question}" ficou sem resposta`);
    assert.doesNotMatch(reply.text, /undefined|NaN|\[object/, `"${question}" gerou texto quebrado: ${reply.text}`);
  }
}

// Respostas apoiadas nos dados das paradas e da simulação.
assert.match(answerByRules('Qual é a tarefa aqui?', atStop).text, /Fotografar e amostrar o contato entre o arenito e as camadas mais antigas/);
assert.match(answerByRules('Por que esta parada importa?', atStop).text, /lacuna no tempo/);
assert.match(answerByRules('Quanto falta?', walking).text, /parada 1, Borda do Greenheugh Pediment/);
assert.match(answerByRules('Quanto falta para o habitat?', walking).text, /^O habitat fica a 400 m/);
assert.match(answerByRules('Por que a parada 3 importa?', walking).text, /enxofre puro/i);
assert.match(answerByRules('A radiação é real?', walking).text, /^Reais: .*taxa de radiação \(média medida pelo RAD.*Simulados: traje, vento/);

// Comandos devolvem ação, com a nota na grafia original.
assert.deepEqual(answerByRules('relatar perigo areia fofa', walking).action, { type: 'report-hazard', hazardType: 'areia', note: '' });
assert.deepEqual(answerByRules('Relatar perigo: Buraco fundo', walking).action, { type: 'report-hazard', hazardType: 'outro', note: 'Buraco fundo' });
assert.deepEqual(answerByRules('relatar buraco', walking).action, { type: 'report-hazard', hazardType: 'outro', note: 'buraco' });
assert.deepEqual(answerByRules('perigo areia', walking).action, { type: 'report-hazard', hazardType: 'areia', note: '' });
assert.deepEqual(answerByRules('registrar amostra: Veio amarelo', atStop).action, { type: 'record-sample', note: 'Veio amarelo' });
assert.deepEqual(answerByRules('registrar amostra', atStop).action, { type: 'record-sample', note: '' });

// Pergunta nunca vira comando: nada disto pode gravar perigo, amostra ou encerrar emergência.
const storm = contextAt(400, { emergencies: { storm: true }, protocol: { id: 'storm', step: 0 } });
for (const question of [
  'Há algum relato de perigo perto?', 'Perigo à frente?', 'A rota está marcada, há declive?', 'Posso relatar um perigo?',
  'Já registrei alguma amostra?', 'Posso registrar a amostra aqui?', 'O que anotar na coleta?', 'tem perigo à frente',
  'Quando termina a emergência?', 'Como encerrar o protocolo?',
]) {
  for (const context of [walking, atStop, storm]) {
    assert.equal(answerByRules(question, context).action, null, `"${question}" virou comando`);
  }
}

// Emergências: alerta crítico, resposta de segurança e condução do protocolo compartilhado.
assert.equal(storm.alerts[0].kind, 'tempestade');
assert.match(answerByRules('É seguro continuar?', storm).text, /^Não é seguro continuar/);
assert.equal(answerByRules('feito', storm).action.type, 'protocol-advance');
assert.equal(answerByRules('encerrar emergência', storm).action.type, 'protocol-end');
assert.match(answerByRules('repetir o passo', storm).text, /^Passo 1 de 4/);
assert.equal(intentOf('feito'), 'confirmacao');
assert.match(answerByRules('o que fazer num evento solar?', walking).text, /proposta da equipe: 1\) Parar a atividade e avisar a base\..*Proteção de relevo mais próxima: encosta a 320 m/);
assert.match(answerByRules('Qual a fonte do protocolo de evento solar?', walking).text, /Fonte: JPL, 10\/06\/2024/);

// Vazamento simulado: O₂ travado no teto em qualquer ponto da rota (a barra não desfaz a emergência).
for (const distM of [0, 400, 4000]) {
  const leak = contextAt(distM, { emergencies: { o2: true } });
  assert.ok(leak.suit.o2Pct <= 18 && leak.alerts.some((alert) => alert.kind === 'o2-critico'), `vazamento sem efeito em ${distM} m`);
}

// Segurança sobre o relevo: rádio sem visada, ponto sem volta e volta a pé que não fecha.
const inGap = contextAt(650);
assert.ok(inGap.alerts.some((alert) => alert.kind === 'sem-visada'));
assert.match(answerByRules('O rádio está funcionando?', inGap).text, /visada volta em 50 m/);
assert.match(answerByRules('O rádio está funcionando?', walking).text, /^Há linha de visada/);
assert.ok(contextAt(2800).alerts.some((alert) => alert.kind === 'sem-volta-a-frente'));
assert.equal(contextAt(4000, { walkBackH: 7 }).alerts.find((alert) => alert.kind === 'sem-volta')?.level, 'critico');
assert.equal(contextAt(4000, { walkBackH: Infinity }).habitat.walkH, null);
assert.match(answerByRules('Onde fica o abrigo mais próximo?', walking).text, /encosta a 320 m.*tapa 35% do céu/);

// Quem hospeda pode trazer os próprios alertas: o assistente responde em cima deles.
const hosted = contextAt(400, { alerts: [{ kind: 'pane', key: 'pane', level: 'critico', text: 'Veículo parado', action: 'Confira o tempo de volta a pé.' }] });
assert.match(answerByRules('É seguro continuar?', hosted).text, /^Não é seguro continuar\. Veículo parado\. Confira o tempo de volta a pé\./);

// Depois da última parada não existe "próxima parada".
const returning = contextAt(plan.path.totalM - 500);
assert.match(answerByRules('Por que a próxima parada importa?', returning).text, /^Não há próxima parada/);
assert.ok(!quickQuestions(returning).some(([label]) => label.includes('próxima parada')));

// Destino livre (plan.isCustom): a parada D vem do plano, não dos dados, e não tem texto de importância.
const destination = { id: 'D', name: 'Destino livre', lat: -4.737, lon: 137.381, el: -4089, ch: 'Destino escolhido no mapa', sci: 'Ponto escolhido pela tripulação.', q: 'O que chamou a atenção aqui?', task: 'Descrever o local.', risk: null, custom: true };
registerStop(destination);
const customPlan = { ...plan, isCustom: true, stops: [{ stop: destination, distM: plan.stops[0].distM }], stopCount: 1 };
const custom = contextAt(400, { plan: customPlan });
assert.equal(custom.focusStop.id, 'D');
for (const question of ['Por que esta parada importa?', 'Qual é a tarefa aqui?', 'O que observar aqui?', 'Quanto falta?', 'Qual é o plano?', 'Resumo']) {
  assert.doesNotMatch(answerByRules(question, custom).text, /undefined|NaN/, `destino livre: "${question}"`);
}
assert.match(answerByRules('Por que esta parada importa?', custom).text, /escolhido no mapa/);

// ---------- Relato de perigos: sozinho, com o armazenamento por parâmetro ----------
const storage = fakeStorage();
const store = createHazardStore(storage);
const position = { lat: walking.position.lat, lon: walking.position.lon, elevM: walking.position.elevM };
const reported = store.report({ type: 'areia', note: '  afunda até o tornozelo ', position, outing: 'anterior', missionH: 1 });
assert.ok(reported.saved && reported.hazard.note === 'afunda até o tornozelo');
assert.equal(store.report({ type: 'vulcao', position, outing: 'x', missionH: 0 }).hazard, null, 'tipo desconhecido não pode entrar');
assert.equal(createHazardStore(storage).list().length, 1, 'o relato tem que sobreviver a uma saída nova');
assert.equal(createHazardStore(fakeStorage({ [HAZARD_STORAGE_KEY]: '{corrompido' })).list().length, 0);
assert.equal(createHazardStore(fakeStorage({ [HAZARD_STORAGE_KEY]: JSON.stringify([{ type: 'areia', lat: 1e308, lon: 1e308, elevM: 0 }, { type: 'areia', lat: 'x', lon: 0, elevM: 0 }]) })).list().length, 0);
assert.match(describeHazard(reported.hazard), /^Areia fofa · lat -4,7\d+, lon 137,3\d+, alt -4\.\d+ m · nota: afunda até o tornozelo · relatado em \d{4}-\d{2}-\d{2}$/);

// Aviso ao se aproximar: 80 m antes do ponto relatado, olhando para ele.
const before = samplePath(plan.path, 320);
const located = locateHazards(store.list(), before, 180, 'esta-saida');
assert.ok(located[0].previous && Math.abs(located[0].distM - 80) < 15);
const warning = hazardWarning([{ ...located[0], ahead: true }]);
assert.match(warning.text, /^Perigo relatado: areia fofa a \d+ m/);
assert.match(warning.action, /saída anterior: “afunda até o tornozelo”/);
assert.equal(hazardWarning([{ ...located[0], ahead: false }]), null);
assert.ok(store.remove(reported.hazard.id) && createHazardStore(storage).list().length === 0);

// No contexto do assistente: alerta e resposta.
const ahead = samplePath(plan.path, 480);
const nearHazard = contextAt(400, { hazards: [{ ...reported.hazard, x: ahead.x, z: ahead.z }] });
assert.ok(nearHazard.alerts.some((alert) => alert.kind === 'perigo-relatado' && alert.key === `perigo-relatado:${reported.hazard.id}`), 'faltou o aviso de perigo relatado');
assert.match(answerByRules('Quais perigos foram relatados?', nearHazard).text, /areia fofa .* de uma saída anterior/);

// ---------- Diário: sozinho ----------
journal.record('chegada', 'Chegada: Borda do Greenheugh Pediment.', atStop, '1');
assert.equal(journal.recordSample('  Veio amarelo  ', atStop, '1'), 'Veio amarelo');
assert.equal(journal.recordSample('', atStop, '1'), '');
assert.deepEqual({ samples: journal.stats().samples, porParada: journal.stats().samplesByStop['1'], ultima: journal.stats().lastSample }, { samples: 2, porParada: 2, ultima: 'Sem observação.' });
const exported = journalToText('a pé, 3 paradas', journal.entries(), [describeHazard(reported.hazard)]);
assert.match(exported, /Plano: a pé, 3 paradas[\s\S]*CHEGADA · parada 1[\s\S]*AMOSTRA · parada 1 .* Veio amarelo[\s\S]*GUARDADOS NESTE NAVEGADOR \(1\)\n- Areia fofa/);
assert.match(journalToText('a pé, destino livre', [], []), /\(nenhum registro\)[\s\S]*\(nenhum\)/);

// ---------- Conversa: sozinha, com tela e voz de mentira ----------
const shown = [];
const actions = [];
const spoken = [];
const voice = { canSpeak: true, canListen: false, isSpeaking: () => true, speak: (text) => spoken.push(text), setSpeaking: () => true, listen: () => false, stopListening: () => {} };
const conversation = createConversation({ getContext: () => walking, onMessage: (message) => shown.push(message), onAction: (action) => actions.push(action), voice });
await conversation.ask('  Quanto falta?  ');
await conversation.ask('relatar perigo areia fofa');
await conversation.ask('   ');
assert.deepEqual(shown.map((message) => message.from), ['user', 'assistant', 'user']);
assert.equal(shown[0].text, 'Quanto falta?');
assert.match(shown[1].text, /^Faltam 460 m/);
assert.equal(shown[1].stamp, '0h10');
assert.deepEqual(actions, [{ type: 'report-hazard', hazardType: 'areia', note: '' }]);
assert.equal(spoken.length, 1, 'só a resposta do assistente é falada');

// Outro motor no lugar das regras (é assim que entra um modelo de linguagem); falha vira aviso.
const remote = createConversation({ getContext: () => walking, onMessage: (message) => shown.push(message), onAction: () => {}, engine: async () => ({ intent: 'modelo', text: 'Resposta do modelo.', action: null }) });
await remote.ask('qualquer coisa');
assert.equal(shown.at(-1).text, 'Resposta do modelo.');
const originalError = console.error;
console.error = () => {};
const broken = createConversation({ getContext: () => walking, onMessage: (message) => shown.push(message), onAction: () => {}, engine: async () => { throw new Error('sem rede'); } });
await broken.ask('qualquer coisa');
console.error = originalError;
assert.deepEqual([shown.at(-1).from, shown.at(-1).text], ['alert', 'O assistente falhou ao responder. Tente de novo.']);

assert.equal((await askAssistant('Quanto falta?', walking)).intent, 'quanto-falta');
assert.ok(quickQuestions(storm)[0][0] === 'Feito' && quickQuestions(atStop)[0][0] === 'Qual é a tarefa aqui?');
assert.equal(toSpeech('O₂ em 97% · 1h05 a 27 µSv/h, -26 °C'), 'oxigênio em 97%, 1 hora e 5 minutos a 27 microsieverts por hora, -26 graus Celsius');

console.log(`ok: ${CASES.length} perguntas em dois contextos, comandos que não disparam por pergunta, emergências, segurança do relevo, destino livre, relato de perigos, diário e conversa.`);
