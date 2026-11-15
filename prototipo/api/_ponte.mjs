// Ponte da IA de bordo na Vercel: o mesmo contrato de tools/servir.py (/ia/saude e /ia/chat),
// escrito como funções. A chave fica nas variáveis do projeto na Vercel e nunca vai para a página.
// Arquivo com "_" no começo não vira rota. Os limites repetem os de servir.py: mudou lá, mude aqui.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-6-luna';
const DEFAULT_REASONING = 'low';
// O raciocínio do modelo conta nesse teto; a resposta em si tem até três frases.
const MAX_ANSWER_TOKENS = 2000;
const MAX_BODY_BYTES = 400_000;
const MAX_MESSAGES = 60;
const MAX_TOOLS = 40;
const UPSTREAM_TIMEOUT_MS = 60_000;

// Limite de chamadas por visitante, o mesmo do servir.py: segura quem tenta gastar o crédito da chave.
// ponytail: a contagem vive na memória da instância da função. A Vercel reaproveita a instância
// entre pedidos, mas pode abrir outras, e aí o limite vale por instância. Para um limite exato,
// criar uma regra de rate limit no firewall do projeto. O teto em dinheiro é o da própria chave.
const RATE_WINDOW_MS = 300_000;
const MAX_CALLS_PER_IP_IN_WINDOW = 60;
const MAX_TRACKED_IPS = 5000;
const callsByIp = new Map();

/**
 * Registra uma chamada e diz se ela cabe no limite da janela. `key` junta o serviço e o visitante
 * (ex.: "ia:1.2.3.4"), para a conversa, a fala e a escuta terem cada uma a sua conta.
 */
export function allowCall(key, limit = MAX_CALLS_PER_IP_IN_WINDOW, now = Date.now()) {
  const recent = (callsByIp.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  const isAllowed = recent.length < limit;
  if (callsByIp.size >= MAX_TRACKED_IPS && !callsByIp.has(key)) callsByIp.clear(); // não cresce sem fim
  callsByIp.set(key, isAllowed ? [...recent, now] : recent);
  return isAllowed;
}

// Na Vercel o endereço do visitante vem nestes cabeçalhos, postos pela própria plataforma.
export function clientIp(request) {
  const forwarded = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return request.headers.get('x-real-ip') || forwarded || 'desconhecido';
}

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
export const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
export const refuse = (status, message) => reply(status, { error: { message } });

/** GET /ia/saude: a página pergunta se há chave neste servidor. */
export function health(env) {
  const hasKey = Boolean(env.OPENROUTER_API_KEY);
  return reply(200, { nuvem: hasKey, modelo: hasKey ? env.OPENROUTER_MODEL || DEFAULT_MODEL : null });
}

// Só a própria página pode gastar o crédito da chave: o pedido tem de vir do mesmo endereço em que
// a função está (o navegador manda Origin em todo POST) e com um tipo de corpo (JSON ou áudio) que
// outro site não consegue mandar sem pedir permissão antes.
export const bodyType = (request) => (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
export function isFromOwnPage(request, isAllowedType = (type) => type === 'application/json') {
  const origin = request.headers.get('origin');
  if (!isAllowedType(bodyType(request))) return false;
  if (origin === null) return true;
  const ownHosts = [request.headers.get('x-forwarded-host'), request.headers.get('host')].filter(Boolean);
  try {
    return ownHosts.includes(new URL(origin).host);
  } catch {
    return false; // "Origin: null" (página isolada) ou valor malformado
  }
}

// Lê { messages, tools? } do corpo. Devolve null se não estiver no formato ou passar dos limites.
function parseBody(raw) {
  try {
    const { messages, tools = [] } = JSON.parse(raw);
    const isValid = Array.isArray(messages) && Array.isArray(tools)
      && messages.length > 0 && messages.length <= MAX_MESSAGES && tools.length <= MAX_TOOLS;
    return isValid ? { messages, tools } : null;
  } catch {
    return null;
  }
}

/** POST /ia/chat: confere o pedido e repassa a conversa ao OpenRouter. */
export async function chat(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return refuse(405, 'use POST');
  if (!isFromOwnPage(request)) return refuse(403, 'pedido recusado: origem ou tipo de conteúdo não permitidos');
  if (!env.OPENROUTER_API_KEY) return refuse(503, 'sem chave do OpenRouter neste servidor');
  if (!allowCall(`ia:${clientIp(request)}`)) return refuse(429, 'muitas perguntas em pouco tempo; espere um pouco');
  const raw = await request.text();
  const size = new TextEncoder().encode(raw).length;
  if (size === 0 || size > MAX_BODY_BYTES) return refuse(413, 'corpo vazio ou grande demais');
  const body = parseBody(raw);
  if (!body) return refuse(400, 'JSON esperado: { messages, tools? }');
  // Modelo e limites são decididos aqui, não pela página.
  const payload = {
    model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
    messages: body.messages,
    max_tokens: MAX_ANSWER_TOKENS,
    reasoning: { effort: env.OPENROUTER_REASONING || DEFAULT_REASONING },
    ...(body.tools.length > 0 && { tools: body.tools }),
  };
  try {
    const upstream = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // O OpenRouter respondeu, com sucesso ou erro: repassa como veio (a página sabe ler os dois).
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  } catch (error) {
    return refuse(502, `sem resposta do OpenRouter: ${error.message}`);
  }
}
