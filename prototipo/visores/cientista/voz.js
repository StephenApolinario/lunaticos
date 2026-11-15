// Voz do assistente: fala com speechSynthesis e, onde o navegador oferece, escuta com
// reconhecimento de fala. Tudo opcional: sem suporte, as funções apenas não fazem nada.
// Independente do HUD: só usa as APIs de voz do navegador (`toSpeech` é pura).

import { IS_LOCAL_PAGE } from '../../src/local.js';

const LANG = 'pt-BR';

function durationWords(_match, hours, minutes) {
  const mins = `${Number(minutes)} minutos`;
  if (hours === '0') return mins;
  return `${hours} ${hours === '1' ? 'hora' : 'horas'} e ${mins}`;
}

// Símbolos do HUD que a síntese de voz leria errado.
const SPEECH_FIXES = Object.freeze([
  // Marcas de destaque do texto (negrito) não são ditas.
  [/[*`]+/g, ''],
  [/O₂/g, 'oxigênio'],
  [/µSv\/h/g, 'microsieverts por hora'],
  [/µSv/g, 'microsieverts'],
  [/%\/h/g, ' por cento por hora'],
  [/kPa/g, ' quilopascais'],
  [/km\/h/g, ' quilômetros por hora'],
  [/m\/s/g, ' metros por segundo'],
  [/(\d) ?km\b/g, '$1 quilômetros'],
  [/(\d) ?m\b(?!\/)/g, '$1 metros'],
  [/(\d) ?min\b/g, '$1 minutos'],
  [/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `${Number(h)} ${Number(h) === 1 ? 'hora' : 'horas'}${m === '00' ? '' : ` e ${Number(m)} minutos`}`],
  [/°C/g, ' graus Celsius'],
  [/°/g, ' graus'],
  [/(\d+)h(\d{2})\b/g, durationWords],
  [/×/g, ' vezes'],
  [/→/g, ' para '],
  [/·/g, ','],
  [/[“”]/g, ''],
]);

/** Texto do HUD na forma em que deve ser dito. */
export const toSpeech = (text) => SPEECH_FIXES
  .reduce((spoken, [pattern, replacement]) => spoken.replace(pattern, replacement), text)
  .replace(/\s+,/g, ',')
  .replace(/\s{2,}/g, ' ');

// Servidor de voz deste computador (tools/voz/servidor.py): fala neural e escuta. Com a página
// publicada ele não existe (ver src/local.js), e valem a voz e a escuta do navegador.
export const VOICE_SERVER = IS_LOCAL_PAGE ? 'http://127.0.0.1:5184' : null;

// Escuta local: o microfone é gravado aqui e transcrito pelo servidor de voz deste computador
// (tools/voz/servidor.py, Whisper). O áudio não vai para a internet e funciona em qualquer navegador.
const LOCAL_LISTEN = Object.freeze({
  healthTimeoutMs: 1500,
  // A gravação para sozinha depois de um silêncio, ou no tempo máximo.
  maxMs: 14000, silenceMs: 1300, checkMs: 100, speechLevel: 0.02,
});

async function localListenReady() {
  if (!VOICE_SERVER) return false;
  try {
    const response = await fetch(`${VOICE_SERVER}/saude`, { signal: AbortSignal.timeout(LOCAL_LISTEN.healthTimeoutMs) });
    return (await response.json()).ouvir === true;
  } catch {
    return false;
  }
}

export function createVoice() {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  let speaking = false;
  let recognition = null;
  // Gravação em andamento: `stop(true)` descarta o áudio, `stop(false)` manda transcrever.
  let recording = null;

  /** Fala o texto se a voz estiver ligada. Uma fala nova interrompe a anterior. */
  function speak(text) {
    if (!speaking || !synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(toSpeech(text));
    utterance.lang = LANG;
    const voice = synth.getVoices().find((candidate) => candidate.lang?.toLowerCase().startsWith('pt'));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }

  /** @returns {boolean} Estado final (false se o navegador não fala). */
  function setSpeaking(next) {
    speaking = Boolean(next) && Boolean(synth);
    if (!speaking) synth?.cancel();
    return speaking;
  }

  function stopListening() {
    recognition?.abort();
    recognition = null;
    recording?.stop(true);
  }

  // Grava até a pessoa parar de falar e manda o áudio para o servidor de voz transcrever.
  async function listenLocally({ onText, onEnd, onError }) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('not-allowed');
      onEnd();
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let heard = false;
    let quietSince = null;
    let discarded = false;
    const stop = (discard) => {
      discarded = discarded || discard;
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const now = performance.now();
      if (level > LOCAL_LISTEN.speechLevel) { heard = true; quietSince = null; } else if (heard) quietSince ??= now;
      if ((quietSince !== null && now - quietSince > LOCAL_LISTEN.silenceMs) || now - startedAt > LOCAL_LISTEN.maxMs) stop(false);
    }, LOCAL_LISTEN.checkMs);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
      if (recording?.stop === stop) recording = null;
      try {
        if (discarded) return;
        if (!heard) { onError('no-speech'); return; }
        const audio = new Blob(chunks, { type: recorder.mimeType });
        const response = await fetch(`${VOICE_SERVER}/ouvir`, { method: 'POST', headers: { 'Content-Type': audio.type.split(';')[0] || 'audio/webm' }, body: audio });
        const { texto } = await response.json();
        if (texto) onText(texto);
        else onError('no-speech');
      } catch {
        onError('network');
      } finally {
        onEnd();
      }
    };
    recording = { stop };
    recorder.start();
  }

  /**
   * Escuta uma frase.
   * @param {{ onText: (text: string) => void, onEnd: () => void, onError: (reason: string) => void }} handlers
   * @returns {boolean} false se não houver reconhecimento de fala.
   */
  function listen(handlers) {
    if (!Recognition && !canRecord) return false;
    stopListening();
    synth?.cancel();
    // Primeiro a escuta local; sem o servidor de voz, a do navegador, se ele tiver.
    (canRecord ? localListenReady() : Promise.resolve(false)).then((local) => {
      if (local) listenLocally(handlers);
      else if (Recognition) listenInBrowser(handlers);
      else { handlers.onError('sem-escuta'); handlers.onEnd(); }
    });
    return true;
  }

  function listenInBrowser({ onText, onEnd, onError }) {
    const session = new Recognition();
    session.lang = LANG;
    session.interimResults = false;
    session.maxAlternatives = 1;
    session.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) onText(text);
    };
    session.onerror = (event) => onError(event.error ?? 'erro');
    session.onend = () => {
      if (recognition === session) recognition = null;
      onEnd();
    };
    recognition = session;
    try {
      session.start();
    } catch {
      recognition = null;
      onError('start');
      onEnd();
    }
  }

  return Object.freeze({
    canSpeak: Boolean(synth),
    canListen: Boolean(Recognition) || canRecord,
    isSpeaking: () => speaking,
    speak,
    setSpeaking,
    listen,
    stopListening,
  });
}
