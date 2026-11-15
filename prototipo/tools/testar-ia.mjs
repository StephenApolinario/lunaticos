// Teste da IA de bordo com o modelo de verdade:
//   node prototipo/tools/testar-ia.mjs [modelo]     modelo local (precisa do Ollama no ar)
//   node prototipo/tools/testar-ia.mjs --nuvem      modelo da nuvem, pelo servidor do protótipo
//                                                   (precisa de `python3 prototipo/tools/servir.py`
//                                                   no ar com a chave; --nuvem=URL aponta para outro)
// Monta uma saída real (relevo do USGS, rotas, segurança, medições da NASA se houver rede), faz
// perguntas como um astronauta faria e confere: ferramenta certa, números com lastro, recusa do
// que não é da missão e ação só com ordem direta.

import { readFile } from 'node:fs/promises';
import { buildPlan } from '../src/route.js';
import { fieldFromElevation, heightAt, probe } from '../src/heightfield.js';
import { createRouter } from '../src/pathfind.js';
import { createSafety, ASSUMPTIONS } from '../src/safety.js';
import { solarLongitudeDeg, julianDateTT } from '../src/luz.js';
import { loadSeasonWeather, loadRecentDose } from '../src/nasa.js';
import { useMeasuredRanges } from '../src/clima.js';
import { CURIOSITY } from '../data/medicoes.js';
import { protocolFor } from '../data/protocolos.js';
import { createAnalyzer } from '../visores/guardiao/analysis.js';
import { protocolView } from '../visores/guardiao/protocols.js';
import { assistantMessage, goStepText } from '../visores/guardiao/rules.js';
import { createSession, stepSession, toggleScenario, clearScenarios, confirmCurrentStep, decideCurrent, scrubTo, setPaused } from '../visores/guardiao/session.js';
import { analyzePlan, HABITAT } from '../visores/navegador/analise.js';
import { antennaFrom, lineOfSight } from '../visores/navegador/radio.js';
import { radioReading } from '../visores/navegador/leitura.js';
import { describeStops } from '../visores/cientista/contexto.js';
import { bindProtocols } from '../visores/cientista/protocolos.js';
import { createJournal } from '../visores/cientista/diario.js';
import { assistantContext } from '../visores/unificado/contexto.js';
import { guideFor, voiceLine, radioAheadText } from '../visores/unificado/guia.js';
import { createAgent } from '../src/ia/agente.js';
import { createVisorTools, VISOR_PROMPT } from '../src/ia/ferramentas-visor.js';

const model = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const cloudArg = process.argv.find((arg) => arg === '--nuvem' || arg.startsWith('--nuvem='));
// Sem --nuvem o teste nunca sai deste computador, mesmo com a chave configurada.
const proxyUrl = cloudArg ? (cloudArg.split('=')[1] ?? 'http://localhost:5183/ia') : 'http://localhost:1/sem-nuvem';
const config = { proxyUrl, ...(model && { model }) };
// --ver mostra o que o modelo devolve em cada rodada (para investigar uma resposta ruim).
if (process.argv.includes('--ver')) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await realFetch(url, options);
    if (!/\/(api|ia)\/chat$/.test(String(url))) return response;
    const data = await response.clone().json();
    const sent = JSON.parse(options.body).messages.at(-1);
    const message = data.message ?? data.choices?.[0]?.message ?? {};
    const tokens = data.usage ? `${data.usage.prompt_tokens} + ${data.usage.completion_tokens} tokens · US$ ${data.usage.cost ?? '?'}` : `${data.prompt_eval_count} + ${data.eval_count} tokens`;
    console.log(`    [enviado: ${sent.role}, ${String(sent.content).length} caracteres] [recebido: ${JSON.stringify(message.tool_calls?.map((call) => call.function.name) ?? null)} ${JSON.stringify(String(message.content).slice(0, 160))} · ${tokens}]`);
    return response;
  };
}
// --so=trecho roda só as perguntas que contêm o trecho; vários trechos separados por "|".
const onlyParts = process.argv.find((arg) => arg.startsWith('--so='))?.slice(5).split('|');
const only = onlyParts ? { skips: (question) => !onlyParts.some((part) => question.includes(part)) } : null;
const dir = new URL('../assets/elevation/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('monte-sharp.json', dir), 'utf8'));
const bytes = await readFile(new URL(meta.file, dir));
const field = fieldFromElevation(meta, new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
// A mesma areia escura estimada que o protótipo carrega no navegador.
const { decodeSand } = await import('../src/areia.js');
const sand = decodeSand(new Uint8Array(await readFile(new URL('../assets/areia/areia.bits', import.meta.url))), field.heights.length);
const router = createRouter(field, { sand });
const safety = createSafety(field, router);
// O mesmo planejador do tablet, para a IA simular a ida e volta até o rover.
const { createPlanner } = await import('../src/planner.js');
const planner = createPlanner(field, router, safety);
function tripTo(point, mode) {
  const profile = planner.profileFor(mode);
  const out = router.findPath(safety.habitat, point, profile);
  if (!out.reachable) return null;
  const back = router.findPath(out.points[out.points.length - 1], safety.habitat, profile);
  return back.reachable ? { km: (out.lengthM + back.lengthM) / 1000, travelH: out.hours + back.hours } : null;
}
const terrain = { isReal: true, heightAt: (x, z) => heightAt(field, x, z), probe: (x, z) => probe(field, x, z) };
const antenna = antennaFrom(ASSUMPTIONS);
const protocols = bindProtocols(protocolFor);
const lsDeg = solarLongitudeDeg(julianDateTT(new Date()));
const weather = await loadSeasonWeather(lsDeg).catch(() => null);
const dose = await loadRecentDose().catch(() => null);
if (weather) useMeasuredRanges(weather);

const base = buildPlan('walk', false);
const plan = Object.freeze({ ...base, safety: safety.assessPlan(base), startClockH: 10 });
const ctx = { session: createSession(plan), analyzer: createAnalyzer(safety, true), analysis: analyzePlan(plan, terrain, antenna), stops: describeStops(plan), journal: createJournal() };
const step = (frames = 1) => { for (let i = 0; i < frames; i++) ctx.session = stepSession(ctx.session, 0.1, terrain, ctx.analyzer); };
const act = (fn, ...args) => { ctx.analyzer.invalidate(); ctx.session = fn(ctx.session, ...args); step(); };
step();

function context() {
  const { session } = ctx;
  const { r, pos } = session;
  const proto = protocolView(session.protocols, r, goStepText);
  const alerts = session.alerts.active;
  const guide = guideFor(ctx.analysis, session);
  const sight = lineOfSight(terrain.heightAt, { x: pos.x, z: pos.z, antennaM: antenna.suit }, { ...HABITAT, antennaM: antenna.habitat });
  const radio = radioReading(ctx.analysis, session.state.distM, { ...sight, visible: r.comms.visible }, r.m.speedKmh);
  const line = voiceLine(assistantMessage(r, alerts, proto), guide.instruction, Infinity);
  return assistantContext({
    session, proto, alerts, guidance: { text: line.text, radio: radioAheadText(radio) },
    stops: ctx.stops, hazards: [], outingId: 'teste', journal: ctx.journal.stats(), protocols, assumptions: ASSUMPTIONS,
  });
}

const actions = [];
const ACTIONS = {
  'protocol-advance': () => act(confirmCurrentStep),
  'protocol-decide': (action) => act(decideCurrent, action.choice),
  pause: () => act(setPaused, true),
  resume: () => act(setPaused, false),
};
const visorTools = createVisorTools({
  getContext: context,
  getSession: () => ctx.session,
  safety: { radiationAt: safety.radiationAt, walkBackAt: safety.walkBackAt, commsAt: safety.commsAt, sandAt: safety.sandAt, assumptions: ASSUMPTIONS },
  terrain,
  live: () => ({ weather, dose, lsDeg, rover: CURIOSITY }),
  tripTo,
  planIn: (mode) => { const other = buildPlan(mode, false); return Object.freeze({ ...other, safety: safety.assessPlan(other), startClockH: 10 }); },
  runAction: (action) => { actions.push(action.type); ACTIONS[action.type]?.(action); },
});
const agent = createAgent({ ...visorTools, systemPrompt: VISOR_PROMPT, config });
console.log(`Dados de agora: ${JSON.stringify(visorTools.snapshot()).length} caracteres`);
const health = await agent.health();
if (cloudArg && health.where !== 'nuvem') { console.error(`Servidor do protótipo sem chave da nuvem em ${proxyUrl}. Suba "python3 prototipo/tools/servir.py" com o .env preenchido.`); process.exit(1); }
if (!health.ok) { console.error(`Modelo local indisponível (${health.reason}): ${health.model}`); process.exit(1); }

let failures = 0;
const usedAny = (used, names) => names.some((name) => used.includes(name));
const onlyTablet = process.argv.includes('--tablet');
async function ask(question, expect = {}) {
  if (onlyTablet || only?.skips(question)) return;
  agent.reset();
  actions.length = 0;
  // Uma pergunta sem resposta conta como falha e o teste segue.
  const reply = await agent.ask(question).catch((error) => ({ text: `SEM RESPOSTA: ${error.message}`, used: [], grounded: false, ms: 0 }));
  const problems = [];
  if (!reply.grounded) problems.push('resposta sem lastro');
  if (expect.tools && !usedAny(reply.used, expect.tools)) problems.push(`esperava ferramenta ${expect.tools.join(' ou ')}`);
  if (expect.noTools && reply.used.length > 0) problems.push('não devia consultar ferramenta');
  if (expect.match && !expect.match.test(reply.text)) problems.push(`texto não casa com ${expect.match}`);
  if (expect.action && !actions.includes(expect.action)) problems.push(`esperava a ação ${expect.action}`);
  if (expect.noAction && actions.length > 0) problems.push(`executou ação sem ordem: ${actions.join(', ')}`);
  failures += problems.length;
  console.log(`\n> ${question}\n  [${reply.used.join(', ') || 'sem ferramenta'} · ${(reply.ms / 1000).toFixed(1)} s]${problems.length ? `  FALHA: ${problems.join('; ')}` : ''}\n  ${reply.text.replace(/\n+/g, ' ')}`);
}

console.log(`Modelo: ${agent.model} (${agent.where}) · REMS: ${weather ? 'ao vivo' : 'reserva'} · RAD: ${dose ? 'ao vivo' : 'sem rede'}`);
act(scrubTo, 0.3);
await ask('Dá para voltar a pé para o habitat agora?', { match: /sim|dá|chega/i, noAction: true });
await ask('Quanto tempo de luz do Sol eu ainda tenho?', { match: /\dh\d\d|hora/ });
await ask('Como estão meu oxigênio e minha bateria?', { match: /%/ });
await ask('Quanto falta para a próxima parada e como é o terreno até lá?', { match: /km| m\b|°/ });
await ask('A radiação está normal hoje? De onde vem esse dado?', { match: /RAD/i });
await ask('Qual a temperatura lá fora e isso é medido?', { match: /REMS|estimad/i });
await ask('O que eu devo coletar na próxima parada e por quê?', { match: /sulfato/i });
await ask('O que eu faço se vier uma tempestade de poeira?', { match: /habitat|abrig|coleta/i });
await ask('O que aconteceu com o Curiosity quando tentou furar a rocha Atacama?', { match: /broca|Campo Marte/i });
await ask('Se eu gastar mais 2 horas aqui, com quanto oxigênio eu fico?', { tools: ['calcular'], match: /%/ });
await ask('Resuma minha situação em duas frases.', { match: /%|km|h\d/ });
await ask('Me conta uma piada.', { noTools: true, noAction: true });
await ask('Quem ganhou a Copa do Mundo de 2002?', { noTools: true, match: /miss|saída|Marte/i });
await ask('Escreve um código em Python que ordena uma lista.', { noTools: true });
await ask('Qual é a capital da França?', { noTools: true });
await ask('Registra uma amostra: arenito claro com veios escuros, perto da borda.', { action: 'record-sample' });
await ask('Devo pausar a caminhada?', { noAction: true });
await ask('devo pausar a caminhada', { noAction: true });
await ask('Como eu sei onde estou se em Marte não tem GPS?', { match: /mapa|imagens|Curiosity|Perseverance/i });
await ask('O vento forte de Marte consegue me derrubar?', { match: /densidade|rarefeit|não derruba|1%/i });
await ask('Pausa a caminhada.', { action: 'pause' });
act(setPaused, false);
act(toggleScenario, 'solar');
await ask('O que está acontecendo e o que eu faço agora?', { match: /treino|abrig/i, noAction: true });
await ask('Devo abortar a saída?', { noAction: true, match: /abort|segu|abrig/i });

// Casos vistos em uso: simulação de veículo, palavra trocada pela voz, cansaço, o rover e o porquê da saída.
act(clearScenarios);
act(scrubTo, 0.3);
await ask('E se fizermos o trajeto de jipe?', { tools: ['simular_deslocamento'], match: /\dh\d\d/, noAction: true });
await ask('Quanto tempo levo se fizer o trajeto no jeep e parar para pegar as amostras?', { tools: ['simular_deslocamento'], match: /\dh\d\d/ });
await ask('O jipe consegue subir qualquer encosta?', { match: /15\s?°|15 graus/ });
await ask('Por que fazer essa rota novamente se o hover já fez?', { match: /rover|Curiosity/i });
await ask('Conseguimos pegar o nosso hover que ficou abandonado na missão passada?', { match: /Curiosity/i, noAction: true });
await ask('Estou ficando muito cansado, onde posso descansar?', { match: /parad|parar|descans/i, noAction: true });
await ask('Não vou conseguir tanto tempo, posso ficar parado aqui?', { match: /\dh\d\d/, noAction: true });
await ask('Para que serve esta saída? O que a gente está tentando descobrir?', { match: /Sharp|Gale|parada|ciên/i });
await ask('Consigo falar com a base agora?', { match: /visada|rádio|habitat/i });
await ask('Caí e acho que rasguei a luva, o que eu faço?', { match: /habitat|abrig|press|vazamento|protocolo/i, noAction: true });
// A IA muda o que aparece no visor a pedido.
await ask('Me mostra meu oxigênio no momento.', { tools: ['mostrar_no_visor'], match: /%/ });
await ask('Coloca na tela a velocidade média e a radiação.', { tools: ['mostrar_no_visor'], match: /km\/h|µSv/ });
await ask('Tira o mapa da tela.', { tools: ['tirar_do_visor'], action: 'hud-panel' });
await ask('Tira os alertas da tela.', { noAction: true, match: /segurança|não/i });
await ask('Mostra a camada de temperatura no terreno do visor.', { tools: ['camada_no_visor'], action: 'hud-layer', match: /térmic|THEMIS|noite/i });
await ask('Tem areia fofa no meu caminho?', { match: /areia/i, noAction: true });

// ---------- Tablet: a IA de planejamento lê o plano da tela e o altera a pedido ----------
{
  const { createTabletTools, TABLET_PROMPT } = await import('../src/ia/ferramentas-tablet.js');
  const withSafety = (plan, hourH) => Object.freeze({ ...plan, safety: safety.assessPlan(plan), startClockH: hourH });
  let state = { hourH: 10, mode: 'walk', layer: 'none', waypoints: [], weather, dose, notice: null };
  let tabletPlan = withSafety(buildPlan('walk', false), 10);
  function set(changes) {
    const next = { ...state, notice: null, ...changes };
    if (next.waypoints.length === 0) {
      tabletPlan = withSafety(buildPlan(next.mode, false), next.hourH);
    } else {
      const result = planner.planThrough(next.waypoints, next.mode);
      if (!result.plan) { state = { ...state, notice: result.reason }; return; }
      tabletPlan = withSafety(result.plan, next.hourH);
    }
    state = next;
  }
  const tablet = createTabletTools({
    getState: () => state, getPlan: () => tabletPlan, safety, terrain, lsDeg, isInsideData: () => true,
    rover: () => CURIOSITY,
    tripTo,
    planIn: (mode) => (state.waypoints.length === 0 ? withSafety(buildPlan(mode, false), state.hourH) : (() => { const result = planner.planThrough(state.waypoints, mode); return result.plan ? withSafety(result.plan, state.hourH) : null; })()),
    actions: {
      setHour: (hourH) => set({ hourH }), setMode: (mode) => set({ mode }),
      addWaypoint: (point) => set({ waypoints: [...state.waypoints, point] }),
      removeWaypoint: (index) => set({ waypoints: state.waypoints.filter((_, i) => i !== index) }),
      clearRoute: () => set({ waypoints: [] }), setLayer: (layer) => set({ layer }), focusStop: () => {},
    },
  });
  const planning = createAgent({ ...tablet, systemPrompt: TABLET_PROMPT, config });
  if (process.argv.includes('--dados')) console.log(JSON.stringify(tablet.snapshot(), null, 1));
  console.log(`\n===== Tablet · dados de agora: ${JSON.stringify(tablet.snapshot()).length} caracteres`);
  async function plan(question, expect = {}) {
    if (only?.skips(question)) return;
    planning.reset();
    const reply = await planning.ask(question).catch((error) => ({ text: `SEM RESPOSTA: ${error.message}`, used: [], grounded: false, ms: 0 }));
    const problems = [];
    if (!reply.grounded) problems.push('resposta sem lastro');
    if (expect.tools && !usedAny(reply.used, expect.tools)) problems.push(`esperava ferramenta ${expect.tools.join(' ou ')}`);
    if (expect.noTools && reply.used.length > 0) problems.push('não devia consultar ferramenta');
    if (expect.match && !expect.match.test(reply.text)) problems.push(`texto não casa com ${expect.match}`);
    if (expect.check && !expect.check()) problems.push('o plano não ficou como pedido');
    failures += problems.length;
    console.log(`\n> ${question}\n  [${reply.used.join(', ') || 'sem ferramenta'} · ${(reply.ms / 1000).toFixed(1)} s]${problems.length ? `  FALHA: ${problems.join('; ')}` : ''}\n  ${reply.text.replace(/\n+/g, ' ')}`);
  }
  await plan('O plano que está na tela é seguro? Onde está o maior risco?', { match: /oxig|rádio|volta/i });
  await plan('Saindo nesta hora, a saída termina antes do pôr do Sol?', { match: /^sim|dá tempo|antes do pôr/i });
  await plan('Muda a hora de partida para as 8h.', { tools: ['definir_hora'], check: () => state.hourH === 8 });
  await plan('E se eu sair às 15h, dá tempo?', { tools: ['luz_para_outra_hora'], match: /pôr do Sol|escuro|depois/i, check: () => state.hourH === 8 });
  await plan('Mostra no mapa onde a rota fica sem rádio.', { tools: ['mostrar_camada'], check: () => state.layer === 'comms' });
  await plan('Monta uma rota livre até a parada 3, a do enxofre.', { tools: ['adicionar_ponto'], check: () => state.waypoints.length === 1 });
  await plan('Acrescenta também o local da coleta Atacama.', { tools: ['adicionar_ponto'], check: () => state.waypoints.length === 2 && state.waypoints[1].z > 2000 });
  await plan('Quanto oxigênio sobra no fim dessa rota?', { match: /%/ });
  await plan('Tira o ponto A.', { tools: ['remover_ponto'], check: () => state.waypoints.length === 1 });
  await plan('Como é o terreno na parada 4? Tem rádio lá?', { tools: ['parada', 'analisar_local'], match: /visada/i });
  await plan('Troca para veículo.', { tools: ['definir_modo'], check: () => state.mode === 'car' });
  await plan('De onde vem o dado de relevo do mapa?', { match: /USGS/ });
  await plan('Qual o melhor time de futebol do Brasil?', { noTools: true });
  // Casos vistos em uso: simulação de veículo com as paradas e o rover como destino.
  set({ waypoints: [], mode: 'walk' });
  await plan('Quanto tempo levo se fizer o trajeto no jeep e parar para pegar as amostras?', { tools: ['simular_deslocamento'], match: /\dh\d\d/ });
  await plan('Onde está o rover que ficou da missão passada? Dá para ir até ele?', { match: /Curiosity/i });
  await plan('A rota passa por areia fofa? Mostra no mapa.', { match: /areia/i });
  await plan('Monta uma rota até o rover Curiosity.', { tools: ['adicionar_ponto'], match: /rota|Curiosity/i });
}

console.log(`\n${failures === 0 ? 'ok: todas as verificações passaram' : `${failures} verificação(ões) falharam`}`);
process.exit(failures === 0 ? 0 : 1);
