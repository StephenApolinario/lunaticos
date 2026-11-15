// Verificação dos adaptadores puros do visor único, sem navegador:
//   node prototipo/visores/unificado/check.mjs
// Usa as rotas reais, o DEM real (se assets/elevation existir) e o mesmo módulo de segurança do tablet.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPlan } from '../../src/route.js';
import { fieldFromElevation, buildHeightField, heightAt, probe } from '../../src/heightfield.js';
import { createRouter } from '../../src/pathfind.js';
import { createSafety, ASSUMPTIONS } from '../../src/safety.js';
import { createPlanner } from '../../src/planner.js';
import { toLocal } from '../../src/geo.js';
import { protocolFor } from '../../data/protocolos.js';
import { SCENARIOS } from '../guardiao/catalog.js';
import { createAnalyzer } from '../guardiao/analysis.js';
import { protocolView, conducting } from '../guardiao/protocols.js';
import { assistantMessage, statusLine, goStepText } from '../guardiao/rules.js';
import { createSession, stepSession, toggleScenario, confirmCurrentStep, decideCurrent, scrubTo, setPaused } from '../guardiao/session.js';
import { analyzePlan } from '../navegador/analise.js';
import { antennaFrom, lineOfSight } from '../navegador/radio.js';
import { HABITAT } from '../navegador/analise.js';
import { radioReading } from '../navegador/leitura.js';
import { describeStops } from '../cientista/contexto.js';
import { bindProtocols } from '../cientista/protocolos.js';
import { createJournal, journalToText } from '../cientista/diario.js';
import { createHazardStore, locateHazards, hazardWarning, describeHazard } from '../cientista/perigos.js';
import { assistantContext, answerUnified, unifiedQuickQuestions, alertsForAssistant } from './contexto.js';
import { guideFor, voiceLine, radioAheadText, withReportedHazard, isReportedHazard, targetLabel, ADVICE_HOLD_S } from './guia.js';

async function loadField() {
  try {
    const dir = new URL('../../assets/elevation/', import.meta.url);
    const meta = JSON.parse(await readFile(new URL('monte-sharp.json', dir), 'utf8'));
    const bytes = await readFile(new URL(meta.file, dir));
    return { field: fieldFromElevation(meta, new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))), real: true };
  } catch {
    return { field: buildHeightField(), real: false };
  }
}

const { field, real } = await loadField();
const router = createRouter(field);
const safety = createSafety(field, router);
const terrain = { isReal: real, heightAt: (x, z) => heightAt(field, x, z), probe: (x, z) => probe(field, x, z) };
const antenna = antennaFrom(ASSUMPTIONS);
const protocols = bindProtocols(protocolFor);
const withSafety = (plan) => Object.freeze({ ...plan, safety: safety.assessPlan(plan) });
const FRAME_S = 0.1;
let checks = 0;
const ok = (label, condition) => { assert.ok(condition, label); checks += 1; };

// Uma saída de teste: a sessão do Guardião mais o que o visor único guarda em volta dela.
function outing(plan, storage = new Map()) {
  const ctx = {
    plan,
    session: createSession(plan),
    analyzer: createAnalyzer(safety, real),
    analysis: analyzePlan(plan, terrain, antenna),
    stops: describeStops(plan),
    journal: createJournal(),
    hazards: createHazardStore({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }),
    acked: new Set(),
  };
  return run(ctx, 1);
}
function run(ctx, frames, until = () => false) {
  for (let i = 0; i < frames && !until(ctx.session); i++) ctx.session = stepSession(ctx.session, FRAME_S, terrain, ctx.analyzer);
  return ctx;
}
const act = (ctx, fn, ...args) => { ctx.analyzer.invalidate(); ctx.session = fn(ctx.session, ...args); return run(ctx, 1); };

// O mesmo que o visor faz a cada quadro: protocolo, perigo relatado, guia, frase e contexto.
function view(ctx, ageS = Infinity) {
  const { session } = ctx;
  const { r, pos } = session;
  const proto = protocolView(session.protocols, r, goStepText);
  const located = locateHazards(ctx.hazards.list(), pos, r.heading, 'teste');
  const alerts = withReportedHazard(session.alerts.active, r.finished || r.sheltered ? null : hazardWarning(located), ctx.acked, r.clockH);
  const guide = guideFor(ctx.analysis, session);
  const sight = lineOfSight(terrain.heightAt, { x: pos.x, z: pos.z, antennaM: antenna.suit }, { ...HABITAT, antennaM: antenna.habitat });
  const radio = radioReading(ctx.analysis, session.state.distM, { ...sight, visible: r.comms.visible }, r.m.speedKmh);
  const message = assistantMessage(r, alerts, proto);
  const line = voiceLine(message, guide.instruction, ageS);
  const context = assistantContext({
    session, proto, alerts, guidance: { text: line.text, radio: radioAheadText(radio) },
    stops: ctx.stops, hazards: ctx.hazards.list(), outingId: 'teste', journal: ctx.journal.stats(), protocols, assumptions: ASSUMPTIONS,
  });
  return { proto, alerts, guide, radio, message, line, context };
}
const ask = (ctx, question) => answerUnified(question, view(ctx).context);

// As ações da conversa, ligadas ao Guardião do mesmo jeito que em visor.js.
function perform(ctx, question) {
  const answer = ask(ctx, question);
  const { action } = answer;
  if (action?.type === 'protocol-advance') act(ctx, confirmCurrentStep);
  if (action?.type === 'protocol-decide') act(ctx, decideCurrent, action.choice);
  if (action?.type === 'pause') act(ctx, setPaused, true);
  if (action?.type === 'resume') act(ctx, setPaused, false);
  return answer;
}

const NUMBERS = ['elapsedH', 'clockH', 'stopsReached'];
const QUESTIONS = [
  'Quanto falta?', 'É seguro continuar?', 'Quanto oxigênio sobra na volta?', 'Como está a bateria?', 'Onde fica o abrigo mais próximo?',
  'Qual a radiação agora?', 'Qual a temperatura?', 'Tem rádio com o habitat?', 'Como é o terreno à frente?', 'Qual a altitude?',
  'Onde fica o ponto sem volta?', 'Por que a próxima parada importa?', 'Qual é a tarefa?', 'O que observar aqui?', 'Qual a pergunta científica?',
  'Quais perigos foram relatados?', 'O que tem no diário?', 'Qual é a rota?', 'Resumo da situação', 'Que horas são?', 'Estou de veículo?',
  'Qual é o protocolo?', 'Qual a fonte disso?', 'O que fazer numa tempestade de poeira?', 'Quem é você?', 'Para onde eu vou agora?',
];

// ---------- 1. Contexto do assistente a partir da sessão do Guardião, nos três tipos de plano ----------
const destination = toLocal(-4.7405, 137.3985);
const planner = createPlanner(field, router, safety);
const custom = planner.planThrough([destination], 'walk');
ok('rota livre de um ponto tem rota', custom.plan?.isCustom && custom.plan.stops.length === 1 && custom.plan.stops[0].stop.id === 'A');
const multi = planner.planThrough([toLocal(-4.7445, 137.3975), destination], 'walk');
ok('rota livre de dois pontos tem rota', multi.plan?.isCustom && multi.plan.stops.map((entry) => entry.stop.id).join('') === 'AB');
// A rota de dois pontos é montada por último: os pontos A e B registrados são os dela.
const PLANS = [['a pé', withSafety(buildPlan('walk', false))], ['veículo com extensão', withSafety(buildPlan('car', true))], ['rota livre', withSafety(multi.plan)]];

for (const [name, plan] of PLANS) {
  const ctx = outing(plan);
  // A meio caminho da primeira parada.
  act(ctx, scrubTo, (plan.stops[0].distM * 0.5) / plan.path.totalM);
  const { context, guide, line, radio } = view(ctx);
  ok(`${name}: números do contexto são finitos`, NUMBERS.every((key) => Number.isFinite(context[key]))
    && [context.suit.o2Pct, context.suit.batteryPct, context.suit.marginH, context.suit.planEndO2Pct, context.suit.hoursToFinish, context.suit.batteryEndPct,
      context.habitat.distM, context.habitat.etaH, context.habitat.o2ArrivalPct, context.position.lat, context.position.elevM, context.target.distM].every(Number.isFinite));
  ok(`${name}: O₂ e margem são os do Guardião`, context.suit.o2Pct === ctx.session.r.o2Pct && Math.abs(context.suit.planEndO2Pct - ctx.session.r.o2EndPct) < 1e-9);
  ok(`${name}: volta a pé é a do relevo`, context.habitat.walkH === ctx.session.r.ret.timeH && context.habitat.o2ArrivalPct === ctx.session.r.ret.o2AfterPct);
  ok(`${name}: a parada em foco vem do plano`, context.focusStop.id === plan.stops[0].stop.id && context.stops.filter((stop) => stop.order >= 0).length === plan.stops.length);
  ok(`${name}: protocolo do Cientista fica nulo`, context.protocol === null && context.guardiao.protocol === null);
  ok(`${name}: seguindo o plano há instrução e divisas até a parada`, guide.following && guide.instruction.text.length > 10 && guide.limitM === plan.stops[0].distM && guide.rejoin === null);
  ok(`${name}: a linha do assistente é a instrução da rota`, line.key.startsWith('guia:') && line.text === guide.instruction.text && !line.logged);
  const advice = { key: 'aviso:declive', priority: 1, text: 'Rampa logo à frente.' };
  ok(`${name}: aviso preventivo ocupa a linha por alguns segundos e entra no histórico`, voiceLine(advice, guide.instruction, 0).text === advice.text && voiceLine(advice, guide.instruction, 0).logged);
  ok(`${name}: depois a linha volta à instrução`, voiceLine(advice, guide.instruction, ADVICE_HOLD_S + 1).text === guide.instruction.text);
  ok(`${name}: rádio à frente tem texto`, radioAheadText(radio).length > 5);
  for (const question of QUESTIONS) {
    const answer = answerUnified(question, context);
    ok(`${name}: "${question}" responde`, typeof answer.text === 'string' && (answer.text.length > 0 || answer.action));
    ok(`${name}: "${question}" não cai em "não sei"`, answer.intent !== 'desconhecido');
  }
  ok(`${name}: "para onde" devolve a instrução`, answerUnified('Para onde eu vou agora?', context).text === guide.instruction.text);
  ok(`${name}: pergunta desconhecida diz que não sabe`, answerUnified('qual o placar do jogo', context).intent === 'desconhecido');
  ok(`${name}: perguntas rápidas incluem a navegação`, unifiedQuickQuestions(context)[0][0] === 'Para onde agora?');
}

// ---------- 2. Evento solar: alerta crítico e o protocolo conduzido até o fim pela conversa ----------
{
  const ctx = outing(PLANS[0][1]);
  act(ctx, scrubTo, 0.1);
  act(ctx, toggleScenario, 'solar');
  let seen = view(ctx);
  ok('solar: alerta do Guardião vira crítico para o assistente', seen.context.alerts[0].kind === 'solar' && seen.context.alerts[0].level === 'critico');
  ok('solar: "é seguro?" responde que não', ask(ctx, 'É seguro continuar?').text.startsWith('Não é seguro continuar'));
  ok('solar: parado, sem divisas', !seen.guide.following && seen.guide.limitM === ctx.session.state.distM && seen.guide.instruction === null);
  ok('solar: a linha do assistente é o passo do protocolo e vai para o histórico', seen.line.key === 'p:solar:1' && seen.line.logged && seen.line.priority === 3);
  ok('solar: perguntas rápidas do protocolo', unifiedQuickQuestions(seen.context)[0][1] === 'feito');
  ok('solar: "qual é o protocolo?" traz o passo do Guardião', ask(ctx, 'Qual é o protocolo?').text.includes('Passo 1 de 5'));
  ok('solar: fonte do protocolo é a da equipe', ask(ctx, 'Qual a fonte disso?').text.includes('Proposta da equipe'));
  ok('solar: "repetir" repete o passo', ask(ctx, 'repetir o passo').text.includes(seen.proto.current.text));

  ok('solar: "feito" confirma o passo 1', perform(ctx, 'feito').action?.type === 'protocol-advance' && view(ctx).proto.stepNumber === 2);
  perform(ctx, 'Feito.');
  seen = view(ctx);
  ok('solar: chegou à decisão', seen.proto.current.type === 'decision' && unifiedQuickQuestions(seen.context)[0][1] === 'abortar');
  const stuck = perform(ctx, 'feito');
  ok('solar: "feito" na decisão não avança e explica', stuck.action === null && stuck.text.includes('decisão') && view(ctx).proto.stepNumber === 3);
  ok('solar: pergunta nunca decide e traz a recomendação', ask(ctx, 'devo abortar?').action === null && ask(ctx, 'abortar?').action === null && ask(ctx, 'devo abortar?').text.includes('Recomendo abortar'));
  ok('solar: "abortar" decide e põe a caminho do abrigo', perform(ctx, 'abortar').action?.choice === 'abortar' && ctx.session.state.nav.kind === 'goto');
  seen = view(ctx);
  ok('solar: indo ao abrigo, "quanto falta" fala do abrigo', seen.context.guardiao.going && ask(ctx, 'Quanto falta?').text === seen.context.guardiao.going);
  ok('solar: "feito" a caminho não avança', perform(ctx, 'feito').action === null && view(ctx).proto.current.type === 'go');
  ok('solar: rótulo do alvo é o abrigo', targetLabel(ctx.session.r).startsWith('Abrigo · '));
  run(ctx, 200000, (session) => Boolean(session.state.sheltered));
  seen = view(ctx);
  ok('solar: chegou ao abrigo e o passo final espera confirmação', ctx.session.state.sheltered && seen.proto.current.type === 'ok' && seen.proto.stepNumber === 5);
  perform(ctx, 'feito');
  ok('solar: protocolo conduzido até o fim pela conversa', conducting(ctx.session.protocols) === null && view(ctx).proto === null);
  ok('solar: "encerrar emergência" é uma ação para quem hospeda', ask(ctx, 'encerrar emergência').action?.type === 'protocol-end');
}

// ---------- 3. Pane do veículo (plano com extensão): decisão, "seguir" e pausa pela conversa ----------
{
  const ctx = outing(PLANS[1][1]);
  act(ctx, scrubTo, 0.3);
  act(ctx, toggleScenario, 'veiculo');
  ok('pane: protocolo aberto, com passo na conversa', view(ctx).context.guardiao.protocol.id === 'veiculo');
  // O Cientista não conhece este protocolo: as perguntas sobre ele não podem quebrar.
  ok('pane: "qual é o protocolo?" responde', ask(ctx, 'Qual é o protocolo?').text.includes('Passo 1 de'));
  ok('pane: "qual a fonte do protocolo?" responde', ask(ctx, 'Qual a fonte do protocolo?').text.includes('Base do protocolo'));
  perform(ctx, 'pronto');
  perform(ctx, 'ok');
  ok('pane: decisão com recomendação de abortar', view(ctx).proto.current.type === 'decision' && ask(ctx, 'Qual é o protocolo?').text.includes('Recomendo abortar'));
  perform(ctx, 'ir para o abrigo');
  ok('pane: a caminho do abrigo a pé', view(ctx).proto.current.type === 'go' && !ctx.session.r.m.driving);
  run(ctx, 400000, (session) => Boolean(session.state.sheltered));
  perform(ctx, 'feito');
  ok('pane: protocolo conduzido até o fim', view(ctx).proto === null);

  const calm = outing(PLANS[1][1]);
  act(calm, toggleScenario, 'vento');
  perform(calm, 'feito');
  perform(calm, 'feito');
  ok('vento: "seguir" na decisão segue a missão', perform(calm, 'seguir').action?.choice === 'seguir' && calm.session.state.nav.kind === 'plan');
  ok('sem decisão pendente, "seguir" volta a ser retomar', ask(calm, 'seguir').action?.type === 'resume');
  ok('"pausar" pausa a sessão do Guardião', perform(calm, 'pausar').action?.type === 'pause' && calm.session.state.paused && view(calm).context.paused);
  ok('"continuar" retoma', perform(calm, 'continuar').action?.type === 'resume' && !calm.session.state.paused);
}

// ---------- 4. Todos os cenários: nenhuma pergunta sobre o protocolo quebra o motor ----------
for (const scenario of SCENARIOS) {
  const ctx = outing(PLANS[1][1]);
  act(ctx, scrubTo, 0.25);
  act(ctx, toggleScenario, scenario.id);
  const { context } = view(ctx);
  for (const question of ['Qual é o protocolo?', 'Qual a fonte do protocolo?', 'É seguro continuar?', 'Resumo da situação', 'feito', 'repetir o passo']) {
    assert.doesNotThrow(() => answerUnified(question, context), `${scenario.id}: "${question}"`);
    checks += 1;
  }
  ok(`${scenario.id}: o protocolo em condução é o do cenário`, context.guardiao.protocol?.id === scenario.id && context.guardiao.protocol.simulated);
}

// ---------- 5. Parada: coleta, amostra no diário e exportação ----------
{
  const ctx = outing(PLANS[0][1]);
  const first = ctx.plan.stops[0];
  act(ctx, scrubTo, (first.distM - 5) / ctx.plan.path.totalM);
  run(ctx, 2000, (session) => session.state.stopsReached === 1);
  act(ctx, setPaused, true);
  const { context, guide } = view(ctx);
  ok('parada: em coleta, sem divisas e sem ponteiro', context.atStop && context.focusStop.id === first.stop.id && !guide.following && guide.point === null);
  ok('parada: pergunta da tarefa usa o texto da parada', answerUnified('Qual é a tarefa aqui?', context).text.includes(first.stop.task));
  const sample = answerUnified('registrar amostra: veio amarelo na base do bloco', context);
  ok('parada: comando de amostra devolve a ação com a nota', sample.action?.type === 'record-sample' && sample.action.note === 'veio amarelo na base do bloco');
  ctx.journal.recordSample(sample.action.note, context, context.focusStop.id);
  ok('parada: amostra contada na parada', ctx.journal.stats().samplesByStop[first.stop.id] === 1);
  ok('parada: exportação traz a amostra', journalToText('a pé, 3 paradas', ctx.journal.entries(), []).includes('veio amarelo na base do bloco'));
}

// ---------- 6. Perigo relatado: guardado, reaparece em outra saída e entra na pilha de alertas ----------
{
  const storage = new Map();
  const ctx = outing(PLANS[0][1], storage);
  act(ctx, scrubTo, 0.2);
  const here = view(ctx).context;
  const command = answerUnified('relatar perigo areia fofa', here);
  ok('perigo: comando devolve a ação', command.action?.type === 'report-hazard' && command.action.hazardType === 'areia');
  const { hazard, saved } = ctx.hazards.report({ type: command.action.hazardType, note: command.action.note, position: here.position, outing: 'anterior', missionH: here.elapsedH });
  ok('perigo: relato gravado', Boolean(hazard) && saved && describeHazard(hazard).startsWith('Areia fofa'));

  const later = outing(PLANS[0][1], storage);
  ok('perigo: outra saída lê o relato guardado', later.hazards.list().length === 1);
  act(later, scrubTo, 0.2 - 60 / later.plan.path.totalM);
  const seen = view(later);
  const reported = seen.alerts.find((alert) => isReportedHazard(alert.id));
  ok('perigo: aviso de aproximação entra na lista do Guardião como atenção', reported?.level === 'atencao' && !reported.ack && reported.cause.includes('areia fofa'));
  ok('perigo: fica antes dos alertas de informação', seen.alerts.slice(0, seen.alerts.indexOf(reported)).every((alert) => alert.level !== 'info'));
  ok('perigo: a linha de estado mostra o aviso', statusLine(later.session.r, seen.alerts).level !== 'seguro');
  ok('perigo: o assistente conta o relato', answerUnified('Quais perigos foram relatados?', seen.context).text.includes('areia fofa'));
  ok('perigo: alerta do assistente inclui o relato', alertsForAssistant(seen.alerts).some((alert) => alert.level === 'atencao' && alert.kind === reported.id));
  later.acked.add(reported.id);
  ok('perigo: reconhecido fica marcado', view(later).alerts.find((alert) => alert.id === reported.id).ack);
  ok('sem aviso, a lista do Guardião volta igual', withReportedHazard(later.session.alerts.active, null, later.acked, 0) === later.session.alerts.active);
}

// ---------- 7. Fim da saída ----------
{
  const ctx = outing(PLANS[2][1]);
  act(ctx, scrubTo, 1);
  const { context, guide, line } = view(ctx);
  ok('fim: contexto marca a saída como concluída', context.finished && answerUnified('Quanto falta?', context).text.includes('terminou'));
  ok('fim: sem guia e com a frase de fim no histórico', !guide.following && guide.point === null && line.key === 'fim' && line.logged);
}

console.log(`unificado: ${checks} verificações passaram (${real ? 'relevo real' : 'relevo aproximado'}).`);
