// Voz do site publicado: o mesmo contrato do servidor de voz local (tools/voz/servidor.py), com
// /saude, /falar e /ouvir, atendido pelo OpenRouter com a chave que a IA de bordo já usa.
// A fala é do Kokoro-82M com a voz pf_dora (o mesmo modelo e a mesma voz do servidor local) e a
// escuta é do Whisper large v3. Arquivo com "_" no começo não vira rota.

import { allowCall, bodyType, clientIp, isFromOwnPage, refuse, reply } from './_ponte.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const SPEECH_MODEL = 'hexgrad/kokoro-82m';
const SPEECH_MODEL_LABEL = 'Kokoro-82M';
const SPEECH_VOICE = 'pf_dora';
const LISTEN_MODEL = 'openai/whisper-large-v3';
const MAX_TEXT_CHARS = 1200;
const MAX_AUDIO_BYTES = 3_000_000;
const UPSTREAM_TIMEOUT_MS = 30_000;
// Por visitante a cada 5 minutos. O visor fala a cada poucos segundos; a escuta é um pedido por pergunta.
const MAX_SPEECH_CALLS = 200;
const MAX_LISTEN_CALLS = 40;
// O formato que o OpenRouter espera, pelo tipo que o navegador gravou (Chrome: webm; Firefox: ogg; Safari: mp4).
const AUDIO_FORMATS = Object.freeze({
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3',
});

const authHeaders = (env) => ({ Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' });

// O que vale para a fala e para a escuta antes de olhar o corpo. Devolve a recusa, ou null se pode seguir.
function refusal(request, env, { isAllowedType, service, limit }) {
  if (request.method !== 'POST') return refuse(405, 'use POST');
  if (!isFromOwnPage(request, isAllowedType)) return refuse(403, 'pedido recusado: origem ou tipo de conteúdo não permitidos');
  if (!env.OPENROUTER_API_KEY) return refuse(503, 'voz indisponível neste servidor');
  if (!allowCall(`${service}:${clientIp(request)}`, limit)) return refuse(429, 'muitos pedidos de voz em pouco tempo; espere um pouco');
  return null;
}

// Chama o OpenRouter. Devolve a resposta dele quando deu certo, ou a recusa que a página deve receber.
async function callUpstream(path, body, env, fetchImpl) {
  try {
    const upstream = await fetchImpl(`${OPENROUTER_URL}/${path}`, {
      method: 'POST', headers: authHeaders(env), body: JSON.stringify(body), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.ok) return { upstream };
    // O motivo fica no registro da função; a página só precisa saber que a voz falhou.
    console.error(`voz: ${path} respondeu ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`);
    return { failure: refuse(upstream.status === 429 ? 429 : 502, 'a voz não respondeu') };
  } catch (error) {
    console.error(`voz: ${path} sem resposta: ${error.message}`);
    return { failure: refuse(502, 'a voz não respondeu') };
  }
}

/** GET /voz/saude: a página pergunta se há fala e escuta neste servidor. */
export function health(env) {
  const isOn = Boolean(env.OPENROUTER_API_KEY);
  return reply(200, { ok: isOn, modelo: SPEECH_MODEL_LABEL, vozes: [SPEECH_VOICE], voz: SPEECH_VOICE, ouvir: isOn });
}

/** POST /voz/falar com { texto }: devolve o áudio (mp3) da frase. */
export async function speak(request, env, fetchImpl = fetch) {
  const refused = refusal(request, env, { isAllowedType: (type) => type === 'application/json', service: 'fala', limit: MAX_SPEECH_CALLS });
  if (refused) return refused;
  let text = '';
  try {
    text = String(JSON.parse(await request.text()).texto ?? '').trim();
  } catch {
    return refuse(400, 'JSON esperado: { texto }');
  }
  if (!text || text.length > MAX_TEXT_CHARS) return refuse(400, `texto vazio ou acima de ${MAX_TEXT_CHARS} caracteres`);
  // A voz é decidida aqui, não pela página.
  const { upstream, failure } = await callUpstream('audio/speech', { model: SPEECH_MODEL, input: text, voice: SPEECH_VOICE, response_format: 'mp3' }, env, fetchImpl);
  if (failure) return failure;
  return new Response(await upstream.arrayBuffer(), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}

/** POST /voz/ouvir com o áudio gravado no corpo: devolve { texto } com a transcrição. */
export async function listen(request, env, fetchImpl = fetch) {
  const refused = refusal(request, env, { isAllowedType: (type) => type in AUDIO_FORMATS, service: 'escuta', limit: MAX_LISTEN_CALLS });
  if (refused) return refused;
  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) return refuse(413, 'áudio vazio ou grande demais');
  const body = { model: LISTEN_MODEL, input_audio: { data: audio.toString('base64'), format: AUDIO_FORMATS[bodyType(request)] }, language: 'pt' };
  const { upstream, failure } = await callUpstream('audio/transcriptions', body, env, fetchImpl);
  if (failure) return failure;
  const { text = '' } = await upstream.json().catch(() => ({}));
  return reply(200, { texto: String(text).trim() });
}
