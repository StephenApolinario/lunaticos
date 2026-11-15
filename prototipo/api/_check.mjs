// Confere a ponte da IA publicada na Vercel, sem rede.   node prototipo/api/_check.mjs
import assert from 'node:assert/strict';
import { allowCall, chat, health } from './_ponte.mjs';
import { health as voiceHealth, listen, speak } from './_voz.mjs';

const SITE = 'https://mapa.exemplo.app';
const env = { OPENROUTER_API_KEY: 'chave-de-teste' };
const body = { messages: [{ role: 'user', content: 'oi' }] };

const post = (payload, headers = {}) => new Request(`${SITE}/api/ia/chat`, {
  method: 'POST',
  headers: { host: 'mapa.exemplo.app', origin: SITE, 'content-type': 'application/json', ...headers },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});
// Faz o papel do OpenRouter e guarda o que recebeu.
function upstream(status = 200, answer = { choices: [{ message: { content: 'ok' } }] }) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init, sent: JSON.parse(init.body) }); return new Response(JSON.stringify(answer), { status }); };
  return { calls, fetchImpl };
}
const status = async (request, useEnv = env) => (await chat(request, useEnv, upstream().fetchImpl)).status;

// Saúde: diz se há chave, sem nunca mostrá-la.
assert.deepEqual(await health(env).json(), { nuvem: true, modelo: 'openai/gpt-6-luna' });
assert.deepEqual(await health({}).json(), { nuvem: false, modelo: null });
assert.equal(JSON.stringify(await health(env).json()).includes('chave-de-teste'), false);

// Quem pode chamar: a própria página, com JSON.
assert.equal(await status(post(body)), 200);
assert.equal(await status(post(body, { origin: 'https://outro.exemplo.net' })), 403, 'outro site');
assert.equal(await status(post(body, { origin: 'null' })), 403, 'página isolada');
assert.equal(await status(post(body, { 'content-type': 'text/plain' })), 403, 'tipo de conteúdo');
assert.equal(await status(new Request(`${SITE}/api/ia/chat`)), 405, 'GET');
assert.equal(await status(post(body), {}), 503, 'sem chave');

// Formato e limites do corpo.
assert.equal(await status(post('não é json')), 400);
assert.equal(await status(post({ messages: [] })), 400);
assert.equal(await status(post({ messages: Array(61).fill(body.messages[0]) })), 400);
assert.equal(await status(post({ messages: body.messages, tools: Array(41).fill({}) })), 400);
assert.equal(await status(post({ messages: [{ role: 'user', content: 'x'.repeat(400_001) }] })), 413);

// O que vai para o OpenRouter: a chave no cabeçalho, e modelo e limites decididos pelo servidor.
const ok = upstream();
const answer = await chat(post({ ...body, model: 'outro/modelo', max_tokens: 99999 }), env, ok.fetchImpl);
assert.equal(answer.status, 200);
assert.equal((await answer.json()).choices[0].message.content, 'ok');
assert.equal(ok.calls[0].init.headers.Authorization, 'Bearer chave-de-teste');
assert.equal(ok.calls[0].sent.model, 'openai/gpt-6-luna');
assert.equal(ok.calls[0].sent.max_tokens, 2000);
assert.equal('tools' in ok.calls[0].sent, false);

// Erro do OpenRouter passa como veio (a página trata 429 e 402); rede caída vira 502.
const busy = upstream(429, { error: { message: 'rate limited' } });
assert.equal((await chat(post(body), env, busy.fetchImpl)).status, 429);
const down = await chat(post(body), env, async () => { throw new Error('rede fora'); });
assert.equal(down.status, 502);

// Limite por visitante: enche a janela, recusa, não afeta outro visitante e volta quando a janela passa.
for (let call = 0; call < 60; call++) assert.equal(allowCall('teste:1.1.1.1', 60, 1000), true);
assert.equal(allowCall('teste:1.1.1.1', 60, 2000), false);
assert.equal(allowCall('teste:2.2.2.2', 60, 2000), true);
assert.equal(allowCall('teste:1.1.1.1', 60, 1000 + 300_001), true);
// Dentro do pedido: o visitante que estourou recebe 429 e o OpenRouter nem é chamado.
for (let call = 0; call < 60; call++) allowCall('ia:3.3.3.3');
const blocked = upstream();
assert.equal((await chat(post(body, { 'x-real-ip': '3.3.3.3' }), env, blocked.fetchImpl)).status, 429);
assert.equal(blocked.calls.length, 0);

// ---------- Voz: fala e escuta ----------
console.error = () => {}; // as falhas simuladas abaixo escreveriam no registro da função
assert.deepEqual(await voiceHealth(env).json(), { ok: true, modelo: 'Kokoro-82M', vozes: ['pf_dora'], voz: 'pf_dora', ouvir: true });
assert.equal((await voiceHealth({}).json()).ok, false);

const sayRequest = (payload, headers = {}) => new Request(`${SITE}/api/voz/falar`, {
  method: 'POST', headers: { host: 'mapa.exemplo.app', origin: SITE, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
});
const heardRequest = (bytes, type = 'audio/ogg; codecs=opus', headers = {}) => new Request(`${SITE}/api/voz/ouvir`, {
  method: 'POST', headers: { host: 'mapa.exemplo.app', origin: SITE, 'content-type': type, ...headers }, body: bytes,
});
// Faz o papel do OpenRouter: devolve áudio para a fala e texto para a escuta.
function voiceUpstream(status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, sent: JSON.parse(init.body), auth: init.headers.Authorization });
    if (status !== 200) return new Response('{"error":{"message":"falhou"}}', { status });
    return url.endsWith('/audio/speech') ? new Response(new Uint8Array([1, 2, 3]), { status: 200 }) : new Response(JSON.stringify({ text: ' Onde me abrigo? ' }), { status: 200 });
  };
  return { calls, fetchImpl };
}

// Fala: a voz e o modelo são do servidor, o texto é o da página, e volta áudio.
const voice = voiceUpstream();
const spoken = await speak(sayRequest({ texto: ' Oxigênio em 82 por cento. ', voz: 'outra_voz' }), env, voice.fetchImpl);
assert.equal(spoken.status, 200);
assert.equal(spoken.headers.get('content-type'), 'audio/mpeg');
assert.equal((await spoken.arrayBuffer()).byteLength, 3);
assert.deepEqual(voice.calls[0].sent, { model: 'hexgrad/kokoro-82m', input: 'Oxigênio em 82 por cento.', voice: 'pf_dora', response_format: 'mp3' });
assert.equal(voice.calls[0].auth, 'Bearer chave-de-teste');
assert.equal((await speak(sayRequest({ texto: '' }), env, voice.fetchImpl)).status, 400);
assert.equal((await speak(sayRequest({ texto: 'x'.repeat(1201) }), env, voice.fetchImpl)).status, 400);
assert.equal((await speak(sayRequest({ texto: 'oi' }, { origin: 'https://outro.exemplo.net' }), env, voice.fetchImpl)).status, 403);
assert.equal((await speak(sayRequest({ texto: 'oi' }), {}, voice.fetchImpl)).status, 503);
assert.equal((await speak(sayRequest({ texto: 'oi' }), env, voiceUpstream(500).fetchImpl)).status, 502);

// Escuta: o áudio vai em base64 com o formato tirado do tipo que o navegador gravou, e volta o texto limpo.
const ear = voiceUpstream();
const heard = await listen(heardRequest(new Uint8Array([79, 103, 103, 83])), env, ear.fetchImpl);
assert.deepEqual(await heard.json(), { texto: 'Onde me abrigo?' });
assert.deepEqual(ear.calls[0].sent, { model: 'openai/whisper-large-v3', input_audio: { data: 'T2dnUw==', format: 'ogg' }, language: 'pt' });
await listen(heardRequest(new Uint8Array([1]), 'audio/webm;codecs=opus'), env, ear.fetchImpl);
await listen(heardRequest(new Uint8Array([1]), 'audio/mp4'), env, ear.fetchImpl);
assert.deepEqual(ear.calls.slice(1).map((call) => call.sent.input_audio.format), ['webm', 'm4a']);
assert.equal((await listen(heardRequest(new Uint8Array([1]), 'application/json'), env, ear.fetchImpl)).status, 403, 'não é áudio');
assert.equal((await listen(heardRequest(new Uint8Array(0)), env, ear.fetchImpl)).status, 413);
assert.equal((await listen(heardRequest(new Uint8Array(3_000_001)), env, ear.fetchImpl)).status, 413);
assert.equal((await listen(heardRequest(new Uint8Array([1]), 'audio/ogg', { origin: 'https://outro.exemplo.net' }), env, ear.fetchImpl)).status, 403);

// A fala tem a própria conta por visitante: estourar a fala não trava a conversa.
for (let call = 0; call < 200; call++) allowCall('fala:4.4.4.4', 200);
assert.equal((await speak(sayRequest({ texto: 'oi' }, { 'x-real-ip': '4.4.4.4' }), env, voice.fetchImpl)).status, 429);
assert.equal((await chat(post(body, { 'x-real-ip': '4.4.4.4' }), env, upstream().fetchImpl)).status, 200);

console.log('ok: ponte da IA e da voz na Vercel (quem pode chamar, limites, uso por visitante e repasse)');
