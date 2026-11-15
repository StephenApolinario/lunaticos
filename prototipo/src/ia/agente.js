// IA de bordo: um modelo de linguagem que responde ao astronauta consultando as ferramentas do
// visor ou do tablet. O modelo não tem dado nenhum de cabeça: tudo o que ele diz com número precisa
// ter vindo de uma ferramenta nesta mesma pergunta, e isso é conferido antes de a resposta aparecer
// (conferencia.js).
//
// Onde o modelo roda:
// - na nuvem, pelo OpenRouter, quando o servidor do protótipo tem a chave (tools/servir.py repassa
//   a conversa; a chave nunca chega à página);
// - neste computador, pelo Ollama, quando não há chave.
// Com chave, a nuvem não cai para o modelo local sozinha: ele ocupa 10 GB de memória.
//
// Usa só `fetch`: roda no navegador e no Node.

import { IS_LOCAL_PAGE } from '../local.js';
import { fmtNumber } from '../format.js';
import { IS_ENGLISH, t } from '../i18n.js';
import { ungroundedNumbers } from './conferencia.js';

export const IA_DEFAULTS = Object.freeze({
  // Rota do servidor do protótipo que repassa a conversa ao OpenRouter. Fora do navegador, passe a
  // URL inteira (por exemplo http://localhost:5183/ia).
  proxyUrl: '/ia',
  // Ollama deste computador. Com a página publicada não há modelo local (ver ../local.js).
  baseUrl: IS_LOCAL_PAGE ? 'http://localhost:11434' : null,
  // Modelo local, escolhido em teste neste projeto (tools/testar-ia.mjs): o de 7B inventava detalhes; este não.
  model: 'qwen3:14b',
  // Sem o raciocínio longo do modelo: a resposta cai de dezenas de segundos para poucos, e os dados já vêm prontos.
  think: false,
  maxRounds: 6,
  historyTurns: 3,
  temperature: 0.2,
  contextTokens: 8192,
  keepAlive: '30m',
  // Três frases cabem com folga; o teto impede o modelo de escrever sem parar.
  maxAnswerTokens: 400,
  timeoutMs: 60000,
  // Folga para o servidor publicado acordar: com 3 s a primeira visita marcava a IA como fora do ar.
  healthTimeoutMs: 8000,
});

// Em que idioma o modelo responde. As regras, os nomes dos campos e os avisos das ferramentas ficam em
// português nos dois idiomas (o modelo lê os dois); os valores dos dados já chegam no idioma da tela.
const ANSWER_STYLE = IS_ENGLISH
  ? 'Responda sempre em inglês (answer in English), mesmo com os dados, os nomes dos campos e estas regras em português: traduza para o inglês o que citar dos dados e copie números e unidades exatamente como estão. Use o vocabulário da tela: a saída é "EVA", parada é "stop", traje é "suit", volta a pé é "walk-back". Use texto corrido e curto'
  : 'Fale em português do Brasil, em texto corrido e curto';
// Lembrete para a segunda tentativa, que refaz a pergunta do zero.
const LANGUAGE_REMINDER = IS_ENGLISH ? ' Responda em inglês.' : '';

// Regras comuns ao visor e ao tablet. Cada um acrescenta quem é e o que as suas ferramentas fazem.
export const BASE_RULES = `Como você trabalha:
- Cada mensagem do astronauta chega com o bloco DADOS DE AGORA, lido dos sensores e cálculos neste instante. Ele é a sua fonte principal. Para o que não estiver nele, chame uma ferramenta.
- Responda só com o que está em DADOS DE AGORA ou no que as ferramentas devolverem nesta pergunta. Nunca invente nem estime número, nome, lugar ou procedimento, e não use conhecimento próprio para completar.
- Copie os valores como estão escritos (por exemplo "1h24", "52%", "${fmtNumber(2.94, 2)} km"). Não converta unidade e não faça conta de cabeça: para somar, subtrair ou comparar valores, chame a ferramenta calcular.
- Quando a mensagem trouxer o bloco FATOS DAS FONTES, ele é o resultado de uma busca nas fontes pesquisadas da missão sobre o assunto da pergunta. Perguntas de conhecimento (como, por que, o que é, de onde vem; Marte, Gale, o Curiosity, a Apollo, trajes, navegação, origem dos dados) se respondem com esses fatos, dizendo de quem é a informação. DADOS DE AGORA responde sobre a situação da saída; não misture fato histórico em resposta sobre a situação.
- Se a resposta não estiver em DADOS DE AGORA nem em FATOS DAS FONTES, chame uma ferramenta (buscar_fatos faz outra busca com as palavras que você escolher). Só diga que um dado não está disponível depois de procurar.
- Os dados trazem a origem: medido, calculado, estimado, hipótese da equipe ou cenário de treino. Diga a origem quando perguntarem de onde vem o dado, e sempre que for hipótese da equipe ou cenário de treino.
- Trate só desta missão: a saída, o traje, a rota, o terreno, o clima, a radiação, a ciência do local, os protocolos e as fontes dos dados. Para qualquer outro assunto (piadas, esportes, programação, conhecimentos gerais), recuse em uma frase e ofereça ajuda com a saída, sem chamar ferramenta.
- Você é a IA de bordo desta missão. Não diga qual modelo de linguagem você é nem como é executada; se perguntarem, diga só que é a IA de bordo e que responde com os dados da saída.
- Destaque com **dois asteriscos** só o número ou a ação mais importante da resposta, no máximo dois destaques. Nenhuma outra marcação: sem listas, títulos, itálico ou tabelas.
- ${ANSWER_STYLE}: no máximo três frases, a mais importante primeiro. Em situação de perigo, comece pela ação. Não escreva nomes de ferramentas nem de campos na resposta.
- Ferramentas de ação (registrar, relatar, conduzir protocolo, pausar, mudar o plano) só com ordem direta do astronauta. Uma pergunta nunca é uma ordem: responda à pergunta sem executar nada.
- A pergunta pode ter sido ditada por voz, com palavra trocada por outra de som parecido: "hover" é o rover, "jipe" ou "jeep" é o veículo da saída. Entenda pelo contexto da missão e responda. Não diga que não tem dados sobre uma palavra trocada.
- O rover desta região é o Curiosity, da NASA. Quando falarem do rover "da missão passada", "abandonado" ou "que fez as análises", é ele: os dados dele estão em rover_curiosity.
- Pergunta do tipo "e se" (ir de veículo ou a pé, quanto tempo levo de jipe, parar mais tempo) se responde com a ferramenta de simulação e a calculadora. Não responda que o plano não traz esse dado sem antes simular.
- Se o astronauta disser que está cansado, passando mal ou que não consegue continuar, não mande seguir. Diga primeiro quanto tempo ele pode ficar parado e onde é seguro parar (parar_aqui e pontos_para_parar), depois as opções de volta e de abrigo.
- Quando perguntarem por que fazer algo ou para que serve a saída, responda com a ciência da parada e com os fatos das fontes, não só com a situação.
- Relato de problema com o traje ou com o corpo (queda, rasgo na luva ou no traje, vazamento, falta de ar, frio, tontura): consulte a ferramenta protocolo (queda, rasgo e vazamento são o cenário oxigenio) e responda com os primeiros passos, começando pela ação.
- Alerta que é só informação (por exemplo trecho sem rádio já previsto no plano) não precisa abrir a resposta: cite-o só se a pergunta for sobre a situação, o rádio ou o que fazer.`;

// Na interface a IA é sempre a "IA de bordo": o protótipo simula o computador da missão. Qual modelo
// responde, e onde ele roda, é assunto do README e do console, não da tela do astronauta.

/** O que dizer ao astronauta quando a IA não responde. O motivo técnico vai para o console. */
export const offlineMessage = () => t('A IA de bordo não respondeu agora. Pergunte de novo em instantes.');

/** Rótulo de quem responde, para o visor e o tablet. */
export const engineLabel = () => t('IA de bordo');

// Recusas passageiras da nuvem (limite por minuto, provedor ocupado): espera e tenta de novo.
const CLOUD_RETRY_STATUS = Object.freeze([429, 502, 503, 504]);
const CLOUD_RETRY_WAITS_MS = Object.freeze([3000, 15000, 45000]);
const CLOUD_MAX_WAIT_MS = 70000;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// O OpenRouter limita conta nova a 20 perguntas por minuto neste modelo e diz quando a janela reabre.
function cloudWaitMs(data, fallbackMs) {
  const untilResetMs = Number(data.error?.metadata?.headers?.['X-RateLimit-Reset']) - Date.now();
  return untilResetMs > 0 && untilResetMs <= CLOUD_MAX_WAIT_MS ? untilResetMs + 500 : fallbackMs;
}

// O motivo da recusa do OpenRouter em palavras que o astronauta entende.
const CLOUD_REFUSALS = Object.freeze({ 401: 'a chave foi recusada', 402: 'a conta do OpenRouter está sem crédito', 403: 'pedido recusado', 429: 'limite de perguntas por minuto atingido', 503: 'sem chave no servidor do protótipo' });
const parseArguments = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};

const UNGROUNDED_REPLY = t('Não consegui confirmar essa resposta nos dados da missão. Pergunte de outro jeito ou peça um dado específico, como traje, rota, clima ou radiação.');
const ACTED_UNGROUNDED_REPLY = t('A ação foi executada e o resultado está na tela, mas não consegui confirmar os números da minha resposta.');
const NO_ANSWER_REPLY = t('Não consegui montar a resposta com os dados da missão. Tente perguntar de outro jeito.');
const JUNK_WARNING = `ATENÇÃO: na tentativa anterior você não respondeu. Responda agora à pergunta do astronauta, em texto corrido e em até três frases. Não repita a pergunta nem copie os blocos de dados.${LANGUAGE_REMINDER}`;
const numberWarning = (numbers) => `ATENÇÃO: na tentativa anterior você escreveu valores que não estão nos dados: ${numbers.join(', ')}. Responda de novo copiando cada valor exatamente como está escrito nos dados, com a mesma unidade (não converta metros em quilômetros nem horas em minutos).${LANGUAGE_REMINDER}`;
// Resposta que devolve os blocos de dados em vez de responder.
const DATA_DUMP = /DADOS DE AGORA|FATOS DAS FONTES|PERGUNTA DO ASTRONAUTA|^\s*[{[]|":\s*"/;
const sameWords = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * @param {{
 *   tools: Array<{ name: string, description: string, parameters?: object, status?: string,
 *     run: (args: object, meta: { question: string }) => unknown | Promise<unknown> }>,
 *   systemPrompt: string,
 *   config?: Partial<typeof IA_DEFAULTS>,
 *   snapshot?: () => unknown,
 *   retrieve?: (question: string) => unknown[],
 *   onStatus?: (text: string | null) => void,
 * }} options `snapshot` devolve os dados da saída neste instante: entram junto com cada pergunta,
 *   para a resposta não depender de o modelo lembrar de consultar. `retrieve` busca nas fontes os
 *   fatos sobre a pergunta, que entram do mesmo jeito. Ferramenta com `action: true` muda algo na
 *   tela. `onStatus` recebe o que a IA está fazendo ("consultando o traje…") e null ao terminar.
 */
export function createAgent({ tools, systemPrompt, config = {}, snapshot = null, retrieve = null, onStatus = () => {} }) {
  const settings = Object.freeze({ ...IA_DEFAULTS, ...config });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const schemas = tools.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters: parameters ?? { type: 'object', properties: {} } },
  }));
  let history = [];
  // Onde o modelo roda, decidido em `health()`: { where: 'nuvem' | 'local', model }.
  let backend = null;
  // A última checagem achou um modelo pronto? Se não, a próxima pergunta confere de novo.
  let isReady = false;

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    return { response, data: await response.json().catch(() => ({})) };
  }

  // Uma rodada com o modelo. Devolve a mensagem para guardar na conversa, o texto e as chamadas de
  // ferramenta já no mesmo formato ({ id, name, args }), venha de onde vier.
  // `allowTools: false` obriga o modelo a responder em texto (usado na última rodada).
  async function chat(messages, allowTools = true) {
    const offered = allowTools ? schemas : [];
    if (backend.where === 'nuvem') {
      let { response, data } = await postJson(`${settings.proxyUrl}/chat`, { messages, tools: offered });
      for (const fallbackMs of CLOUD_RETRY_WAITS_MS) {
        if (!CLOUD_RETRY_STATUS.includes(response.status)) break;
        const waitMs = cloudWaitMs(data, fallbackMs);
        onStatus(t`IA de bordo ocupada, tentando de novo em ${Math.ceil(waitMs / 1000)} s…`);
        await wait(waitMs);
        ({ response, data } = await postJson(`${settings.proxyUrl}/chat`, { messages, tools: offered }));
      }
      const message = data.choices?.[0]?.message;
      if (!response.ok || data.error || !message) {
        throw new Error(CLOUD_REFUSALS[response.status] ?? String(data.error?.message ?? `resposta ${response.status}`).slice(0, 120));
      }
      const toolCalls = message.tool_calls ?? [];
      return {
        // Só o que a conversa precisa de volta; `reasoning_details` mantém o raciocínio do modelo entre as rodadas.
        message: { role: 'assistant', content: message.content ?? '', ...(toolCalls.length > 0 && { tool_calls: toolCalls }), ...(message.reasoning_details && { reasoning_details: message.reasoning_details }) },
        text: message.content,
        calls: toolCalls.map((call) => ({ id: call.id, name: call.function?.name, args: parseArguments(call.function?.arguments) })),
      };
    }
    if (!settings.baseUrl) throw new Error('sem modelo local nesta página');
    const { response, data } = await postJson(`${settings.baseUrl}/api/chat`, {
      model: settings.model, messages, tools: offered, stream: false, keep_alive: settings.keepAlive, think: settings.think,
      options: { temperature: settings.temperature, num_ctx: settings.contextTokens, num_predict: settings.maxAnswerTokens },
    });
    if (!response.ok || data.error || !data.message) throw new Error(`Modelo local: ${data.error ?? `resposta ${response.status}`}`);
    return {
      message: data.message,
      text: data.message.content,
      calls: (data.message.tool_calls ?? []).map((call) => ({ name: call.function?.name, args: parseArguments(call.function?.arguments) })),
    };
  }

  const toolMessage = (call, content) => (backend.where === 'nuvem'
    ? { role: 'tool', tool_call_id: call.id, content }
    : { role: 'tool', tool_name: call.name, content });

  // O servidor do protótipo tem a chave da nuvem? Devolve o nome do modelo de lá, ou null.
  async function cloudModel() {
    try {
      const response = await fetch(`${settings.proxyUrl}/saude`, { signal: AbortSignal.timeout(settings.healthTimeoutMs) });
      const data = await response.json();
      return data.nuvem ? String(data.modelo) : null;
    } catch {
      return null;
    }
  }

  /**
   * Onde a IA vai rodar e se está pronta. Na nuvem, "pronta" quer dizer que o servidor tem a chave;
   * crédito e rede só aparecem na primeira pergunta.
   */
  async function health() {
    const found = await findBackend();
    isReady = found.ok;
    return found;
  }

  async function findBackend() {
    const cloud = await cloudModel();
    if (cloud) {
      backend = { where: 'nuvem', model: cloud };
      return { ok: true, ...backend };
    }
    backend = { where: 'local', model: settings.model };
    if (!settings.baseUrl) return { ok: false, reason: 'fora-do-ar', ...backend };
    try {
      const response = await fetch(`${settings.baseUrl}/api/tags`, { signal: AbortSignal.timeout(settings.healthTimeoutMs) });
      const { models = [] } = await response.json();
      const names = models.map((model) => model.name);
      return names.includes(settings.model) ? { ok: true, ...backend } : { ok: false, reason: 'sem-modelo', ...backend, models: names };
    } catch {
      return { ok: false, reason: 'fora-do-ar', ...backend };
    }
  }

  // `done` guarda as ações já executadas nesta pergunta: se o modelo pedir a mesma de novo (por
  // exemplo na segunda tentativa de resposta), ela não roda duas vezes.
  // `seen` guarda as consultas (sem ação) já feitas nesta pergunta.
  async function runTool(call, question, done, seen) {
    const tool = byName.get(call.name);
    if (!tool) return { erro: `Ferramenta desconhecida: ${call.name}. Use só as ferramentas listadas.` };
    const key = `${tool.name}:${JSON.stringify(call.args)}`;
    if (tool.action && done.has(key)) return done.get(key);
    // Consulta repetida: o resultado já está na conversa. Sem isto o modelo pode ficar consultando em círculo.
    if (!tool.action && seen.has(key)) return { aviso: 'Você já fez esta consulta nesta pergunta e o resultado está acima. Responda agora ao astronauta com os dados que já tem.' };
    if (!tool.action) seen.add(key);
    onStatus(tool.status ?? t`consultando ${tool.name}…`);
    try {
      const result = await tool.run(call.args, { question });
      if (tool.action && result?.feito) done.set(key, result);
      return result;
    } catch (error) {
      return { erro: error instanceof Error ? error.message : 'Falha ao consultar a ferramenta.' };
    }
  }

  /**
   * Responde a uma pergunta. Rejeita se o modelo não responder (quem chama decide o que mostrar).
   * @returns {Promise<{ text: string, used: string[], grounded: boolean, ms: number }>}
   */
  async function ask(rawQuestion) {
    const question = String(rawQuestion ?? '').trim();
    const startedAt = Date.now();
    // Se a última checagem não achou modelo pronto, confere de novo antes de responder: uma falha na
    // abertura da página (servidor ainda acordando) não pode deixar a IA fora do ar até recarregar.
    if (!isReady) await health();
    // Os dados de agora vão colados na pergunta e contam como lastro. No histórico fica só a pergunta,
    // para um dado velho nunca ser reaproveitado.
    const now = snapshot ? JSON.stringify(snapshot()) : null;
    const found = retrieve ? retrieve(question) : [];
    const facts = found.length > 0 ? JSON.stringify(found) : null;
    const content = [
      now && `DADOS DE AGORA:\n${now}`,
      facts && `FATOS DAS FONTES (busca automática sobre a pergunta):\n${facts}`,
      `PERGUNTA DO ASTRONAUTA: ${question}`,
    ].filter(Boolean).join('\n\n');
    // A segunda tentativa não continua a conversa: refaz a pergunta do zero, com o aviso do que
    // estava errado no fim. (Emendar uma bronca na conversa fazia o modelo despejar os dados brutos.)
    const startOver = (warning) => [
      { role: 'system', content: systemPrompt }, ...history,
      { role: 'user', content: warning ? `${content}\n\n${warning}` : content },
    ];
    let messages = startOver(null);
    const evidence = [question, now, facts].filter(Boolean);
    const done = new Map();
    const seen = new Set();
    const used = [];
    let text = '';
    let retried = false;
    onStatus(t('pensando…'));
    try {
      for (let round = 0; round < settings.maxRounds; round++) {
        // Na última rodada o modelo não pode mais consultar: tem de responder com o que já tem.
        const reply = await chat(messages, round < settings.maxRounds - 1);
        messages.push(reply.message);
        if (reply.calls.length > 0) {
          for (const call of reply.calls) {
            const output = JSON.stringify(await runTool(call, question, done, seen));
            evidence.push(output);
            used.push(call.name ?? '?');
            messages.push(toolMessage(call, output));
          }
          continue;
        }
        text = String(reply.text ?? '').trim();
        // Não é resposta: vazio, a pergunta repetida ou os dados despejados de volta.
        const isJunk = text === '' || sameWords(text, question) || DATA_DUMP.test(text);
        const loose = isJunk ? [] : ungroundedNumbers(text, evidence);
        if (!isJunk && loose.length === 0) break;
        text = '';
        // Uma segunda chance; se o erro se repetir, a resposta não sai.
        if (retried) return { text: done.size > 0 ? ACTED_UNGROUNDED_REPLY : UNGROUNDED_REPLY, used, grounded: false, ms: Date.now() - startedAt };
        retried = true;
        onStatus(isJunk ? t('tentando de novo…') : t('conferindo os números…'));
        messages = startOver(isJunk ? JUNK_WARNING : numberWarning(loose));
      }
      if (!text) text = NO_ANSWER_REPLY;
      history = [...history, { role: 'user', content: question }, { role: 'assistant', content: text }].slice(-2 * settings.historyTurns);
      return { text, used, grounded: true, ms: Date.now() - startedAt };
    } finally {
      onStatus(null);
    }
  }

  return Object.freeze({
    ask,
    health,
    reset: () => { history = []; },
    /** Onde a IA roda agora ('nuvem' ou 'local') e com qual modelo; antes da primeira checagem, o local. */
    get where() { return backend?.where ?? 'local'; },
    get model() { return backend?.model ?? settings.model; },
  });
}
