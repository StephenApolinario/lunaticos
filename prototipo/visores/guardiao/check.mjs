// Verificação do motor do Guardião, sem navegador: node prototipo/visores/guardiao/check.mjs
// Usa as rotas reais, o DEM real e o mesmo módulo de segurança que o tablet usa.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPlan } from '../../src/route.js';
import { createSimState, jumpTo, deriveReadout } from '../../src/simulation.js';
import { fieldFromElevation, heightAt, probe } from '../../src/heightfield.js';
import { createRouter } from '../../src/pathfind.js';
import { createSafety } from '../../src/safety.js';
import { RULES, FAULTS, SCENARIOS, PROTOCOLS } from './catalog.js';
import { o2PctOf, mobility } from './engine.js';
import { createAnalyzer, pickShelter } from './analysis.js';
import { createAlerts, syncAlerts, ackAlert } from './alerts.js';
import { stepsOf, protocolView } from './protocols.js';
import { goStepText } from './rules.js';
import {
  createSession, stepSession, toggleScenario, clearScenarios, acknowledge, confirmCurrentStep, decideCurrent, scrubTo,
} from './session.js';

const elevationDir = new URL('../../assets/elevation/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('monte-sharp.json', elevationDir), 'utf8'));
const bytes = await readFile(new URL(meta.file, elevationDir));
const field = fieldFromElevation(meta, new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const safety = createSafety(field, createRouter(field));
const terrain = { isReal: true, heightAt: (x, z) => heightAt(field, x, z), probe: (x, z) => probe(field, x, z) };
const FRAME_S = 0.1;

const planFor = (mode, extension) => { const plan = buildPlan(mode, extension); return Object.freeze({ ...plan, safety: safety.assessPlan(plan) }); };
const start = (mode, extension) => ({ session: createSession(planFor(mode, extension)), analyzer: createAnalyzer(safety, true) });
function run(ctx, frames, until = () => false) {
  for (let i = 0; i < frames && !until(ctx.session); i++) ctx.session = stepSession(ctx.session, FRAME_S, terrain, ctx.analyzer);
  return ctx.session;
}
const act = (ctx, fn, ...args) => { ctx.analyzer.invalidate(); ctx.session = fn(ctx.session, ...args); return run(ctx, 1); };
const alertOf = (session, id) => session.alerts.active.find((alert) => alert.id === id);
const scrub = (ctx, fraction) => act(ctx, scrubTo, fraction);
const confirmUntilDecision = (ctx, id) => { for (let i = 0; stepsOf(id)[i].type === 'ok'; i++) act(ctx, confirmCurrentStep); };
let checks = 0;
const ok = (label, condition) => { assert.ok(condition, label); checks += 1; };

// 1. Sem cenário, o consumo integrado fecha com o do visor base.
{
  const ctx = start('walk', false);
  const end = run(ctx, 200000, (session) => session.state.finished);
  const base = deriveReadout(end.plan, jumpTo(end.plan, createSimState(), end.plan.path.totalM), terrain.probe(0, 0));
  ok('saída a pé termina no habitat', end.state.finished && end.state.sheltered === 'habitat');
  ok('O₂ final igual ao do visor base', Math.abs(o2PctOf(end.state) - base.suit.o2Pct) < 0.5);
  ok('tempo de saída igual ao do visor base', Math.abs(end.state.clockH - base.elapsedH) < 0.02);
  ok('sem cenário, nenhum alerta acima de informação fica no fim', end.alerts.active.every((alert) => alert.level === 'info'));
}

// 2. Ponto de não retorno: o mesmo do tablet (plan.safety.noReturn) enquanto nada foge do plano.
{
  ok('a pé, base: volta garantida em toda a rota', run(start('walk', false), 1).r.pnr.status === 'none');
  for (const mode of ['walk', 'car']) {
    const ctx = start(mode, true);
    const { r, plan } = run(ctx, 1);
    ok(`${mode}, extensão: ponto de não retorno igual ao do tablet`, r.pnr.status === 'ahead' && Math.abs(r.pnr.distM - plan.safety.noReturn.distM) < 1);
  }
  ok('a pé, extensão: O₂ não cobre o plano', alertOf(run(start('walk', true), 1), 'o2-plano')?.level === 'perigo');
  const carExt = start('car', true);
  const first = run(carExt, 1).r;
  // Logo depois dele, a resposta a "se o veículo quebrar, volto a pé?" passa a ser não.
  const beyond = scrub(carExt, (first.pnr.distM + 60) / carExt.session.plan.path.totalM);
  ok('depois do ponto de não retorno a volta a pé não fecha', beyond.r.pnr.status === 'passed' && !beyond.r.ret.ok);
  ok('alerta de ponto de não retorno aparece', alertOf(beyond, 'pnr')?.title === 'Além do ponto de não retorno');
  const before = scrub(carExt, (first.pnr.distM - 300) / carExt.session.plan.path.totalM);
  ok('avisa antes do ponto de não retorno', alertOf(before, 'pnr')?.title === 'Ponto de não retorno próximo' && before.r.ret.ok);
}

// 3. Pane do veículo: passa a andar a pé, o protocolo para o astronauta e conduz a volta.
{
  const ctx = start('car', false);
  scrub(ctx, 0.3);
  ok('no veículo, dirigindo', mobility(ctx.session.plan, ctx.session.state).driving);
  ok('pane do veículo é ignorada no plano a pé', toggleScenario(createSession(planFor('walk', false)), 'veiculo').state.scenarios.veiculo === undefined);
  const failed = act(ctx, toggleScenario, 'veiculo');
  ok('pane abre alerta de perigo e protocolo', alertOf(failed, 'veiculo')?.level === 'perigo' && failed.protocols[0].id === 'veiculo');
  ok('protocolo novo começa com parada', run(ctx, 1).state.nav.kind === 'hold');
  const view = protocolView(ctx.session.protocols, ctx.session.r, goStepText);
  ok('protocolo traz título e fonte da equipe', view.title === 'Pane do veículo' && view.source.startsWith('Proposta da equipe'));
  confirmUntilDecision(ctx, 'veiculo');
  ok('chegou ao ponto de decisão', stepsOf('veiculo')[ctx.session.protocols[0].step].type === 'decision');
  const predicted = ctx.session.r.picks.veiculo;
  const clockAtDecision = ctx.session.state.clockH;
  const going = act(ctx, decideCurrent, 'abortar');
  ok('abortar manda para o habitat a pé', going.state.nav.target.kind === 'habitat' && !mobility(going.plan, going.state).driving);
  const home = run(ctx, 200000, (session) => session.state.finished);
  ok('chega ao habitat e a ida ao abrigo é concluída', home.state.sheltered === 'habitat' && stepsOf('veiculo')[home.protocols[0].step].type === 'ok');
  ok('a volta leva o tempo previsto', Math.abs(home.state.clockH - clockAtDecision - predicted.timeH) < 0.05);
  ok('o O₂ na chegada é o previsto', Math.abs(o2PctOf(home.state) - predicted.o2AfterPct) < 1);
}

// 4. Evento solar: emergência, dose sobe, reconhecer silencia sem encerrar, limpar retoma o plano.
{
  const ctx = start('walk', false);
  scrub(ctx, 0.2);
  const hit = act(ctx, toggleScenario, 'solar');
  ok('evento solar é emergência', alertOf(hit, 'solar')?.level === 'emergencia' && !alertOf(hit, 'solar').ack);
  ok('taxa de radiação multiplicada', hit.r.radiationRate > 20 * (FAULTS.solarFactor - 1));
  const acked = act(ctx, acknowledge);
  ok('reconhecido continua ativo', alertOf(acked, 'solar')?.ack === true);
  ok('histórico guarda o reconhecimento', acked.alerts.history.some((entry) => entry.id === 'solar' && entry.ackH !== null));
  const cleared = act(ctx, clearScenarios);
  ok('sem cenário o alerta some e fica no histórico', !alertOf(cleared, 'solar') && cleared.alerts.history.some((entry) => entry.id === 'solar' && entry.clearedH !== null));
  ok('fim da emergência retoma o plano', run(ctx, 2).state.nav.kind === 'plan');
}

// 5. Traje danificado: vazamento, selante reduz, abrigo pressurizado.
{
  const ctx = start('car', false);
  scrub(ctx, 0.4);
  const hurt = act(ctx, toggleScenario, 'traje');
  ok('traje danificado é emergência com vazamento', alertOf(hurt, 'traje')?.level === 'emergencia' && hurt.r.leakPctH > RULES.leakEmergencyPctH);
  confirmUntilDecision(ctx, 'traje');
  const patched = ctx.session;
  ok('selante reduz o vazamento', patched.state.patched && patched.r.leakPctH < hurt.r.leakPctH);
  ok('abrigo recomendado é o veículo, que está aqui', patched.r.picks.traje.kind === 'vehicle' && patched.r.picks.traje.distM === 0);
  act(ctx, decideCurrent, 'abortar');
  ok('abrigado no veículo, o alerta cai para informação', run(ctx, 3).state.sheltered === 'vehicle' && alertOf(ctx.session, 'traje').level === 'info');
}

// 6. O₂ na reserva, abrigo no relevo real e poeira com recomendação de seguir.
{
  const ctx = start('walk', false);
  scrub(ctx, 0.5);
  const low = act(ctx, toggleScenario, 'o2');
  ok('O₂ cai abaixo da reserva e abre emergência', low.r.o2Pct < RULES.o2ReservePct && alertOf(low, 'o2')?.level === 'emergencia');
  ok('sem veículo, a única fonte de O₂ é o habitat', low.r.picks.o2 === null || low.r.picks.o2.kind === 'habitat');

  const solar = start('walk', false);
  scrub(solar, 0.5);
  act(solar, toggleScenario, 'solar');
  const terrainSpot = solar.session.r.shelters.find((option) => option.kind === 'terrain');
  ok('o relevo real oferece abrigo perto do ponto mais distante', terrainSpot && terrainSpot.skyBlocked > 0.1);
  ok('habitat fora do prazo de 1 h: o abrigo indicado é o relevo', solar.session.r.picks.solar.kind === 'terrain');
  confirmUntilDecision(solar, 'solar');
  act(solar, decideCurrent, 'abortar');
  const hidden = run(solar, 200000, (session) => session.state.sheltered !== null);
  ok('sai da rota e chega ao abrigo no relevo', hidden.state.sheltered === 'terrain' && hidden.state.off !== null && hidden.state.exposure < 1);
  act(solar, clearScenarios);
  ok('fim do evento: volta à rota e retoma o plano', run(solar, 200000, (session) => session.state.off === null).state.nav.kind === 'plan');

  const dust = start('walk', false);
  scrub(dust, 0.95);
  act(dust, toggleScenario, 'poeira');
  confirmUntilDecision(dust, 'poeira');
  ok('perto do fim, a recomendação é seguir', PROTOCOLS.poeira.recommend(dust.session.r).abort === false);
  act(dust, decideCurrent, 'seguir');
  ok('seguir encerra o protocolo e retoma o plano', dust.session.protocols[0].done && dust.session.state.nav.kind === 'plan');
}

// 7. Gerente de alertas: prioridade, agravamento e limite do histórico.
{
  const cond = (id, level) => ({ id, level, title: id, cause: '', effect: '', action: '' });
  let { state } = syncAlerts(createAlerts(), [cond('a', 'atencao'), cond('b', 'emergencia'), cond('c', 'info')], 1);
  ok('ordem por nível', state.active.map((alert) => alert.id).join('') === 'bac');
  ok('informação não pede reconhecimento', state.active.find((alert) => alert.id === 'c').ack);
  state = ackAlert(state, 'a', 1.1);
  const worse = syncAlerts(state, [cond('a', 'perigo'), cond('b', 'emergencia')], 1.2);
  ok('agravar reabre o reconhecimento', worse.events.some((event) => event.type === 'escalated') && !worse.state.active.find((alert) => alert.id === 'a').ack);
  ok('alerta que some gera evento', worse.events.some((event) => event.type === 'cleared' && event.alert.id === 'c'));
  let many = createAlerts();
  for (let i = 0; i < 200; i++) many = syncAlerts(many, i % 2 ? [cond('x', 'atencao')] : [], i).state;
  ok('histórico tem tamanho limitado', many.history.length <= 60);
}

// 8. Política de escolha de abrigo.
{
  const options = [
    { kind: 'habitat', timeH: 2, reaches: true }, { kind: 'vehicle', timeH: 0.5, reaches: true }, { kind: 'terrain', timeH: 0.1, reaches: true },
  ];
  const policy = (budgetH) => ({ kinds: ['habitat', 'vehicle', 'terrain'], budgetH: () => budgetH });
  ok('dentro do prazo vale a melhor proteção', pickShelter(options, policy(3)).kind === 'habitat');
  ok('prazo curto escolhe o que dá tempo', pickShelter(options, policy(1)).kind === 'vehicle');
  ok('fora do prazo, o mais próximo como provisório', pickShelter(options, policy(0.05)).provisional === true);
  ok('sem O₂ para nenhum, não há abrigo', pickShelter(options.map((option) => ({ ...option, reaches: false })), policy(3)) === null);
}

// 9. Todo cenário do painel abre alerta e protocolo; o rádio usa a visada real.
for (const scenario of SCENARIOS) {
  const ctx = start('car', true);
  scrub(ctx, 0.35);
  const session = act(ctx, toggleScenario, scenario.id);
  ok(`cenário ${scenario.id} abre alerta e protocolo`, alertOf(session, scenario.id) && session.protocols.some((instance) => instance.id === scenario.id));
}
{
  const ctx = start('walk', false);
  const session = scrub(ctx, 0.5);
  const visible = safety.commsAt(session.pos.x, session.pos.z).visible;
  ok('rádio segue a linha de visada do relevo', session.r.radio.state === (visible ? 'ok' : 'shadow'));
}

console.log(`Guardião: ${checks} verificações passaram.`);
