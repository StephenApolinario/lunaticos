// Som dos alertas (Web Audio) e voz do assistente, cada um com a própria chave de liga e
// desliga. A preferência fica guardada no navegador. A voz vem do servidor local
// (prototipo/tools/voz, Kokoro) quando ele responde; senão, do speechSynthesis do navegador.

import { IS_LOCAL_PAGE } from '../../src/local.js';
import { t, LANG, HTML_LANG, IS_ENGLISH } from '../../src/i18n.js';
import { toSpeech, VOICE_SERVER } from '../cientista/voz.js';

const STORAGE = Object.freeze({ sound: 'guardiao:som', voice: 'guardiao:voz' });
const VOLUME = 0.09;
const ATTACK_S = 0.012;
const PROBE_TIMEOUT_MS = 4000; // folga para a função do site publicado acordar
const PROBE_RETRY_MS = 10000;
const SYNTH_RATE = 1.1;
// Vozes do sistema, da mais natural para a menos: Premium/Enhanced/Natural, depois Google.
const VOICE_RANKS = Object.freeze([/premium|enhanced|natural/i, /google/i]);

// Um padrão por nível: [frequência em Hz, início em s, duração em s].
const PATTERNS = Object.freeze({
  info: { wave: 'sine', notes: [[880, 0, 0.12]] },
  atencao: { wave: 'triangle', notes: [[587, 0, 0.16], [784, 0.2, 0.22]] },
  perigo: { wave: 'square', notes: [[740, 0, 0.12], [740, 0.18, 0.12], [740, 0.36, 0.12]] },
  emergencia: { wave: 'sawtooth', notes: [[523, 0, 0.22], [784, 0.24, 0.22], [523, 0.48, 0.22], [784, 0.72, 0.22]] },
});
// Ondas quadrada e dente de serra soam mais alto que a senoide no mesmo ganho.
const WAVE_GAIN = Object.freeze({ sine: 1, triangle: 1, square: 0.45, sawtooth: 0.5 });

function readPref(key) {
  try {
    return window.localStorage.getItem(key) !== 'off';
  } catch {
    return true; // sem armazenamento (modo privado), vale o padrão ligado
  }
}

function writePref(key, on) {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // A preferência só não persiste; o botão continua funcionando nesta visita.
  }
}

// Voz do idioma da interface: qualquer inglês (en-US, en-GB…) ou só o português do Brasil.
const speaksInterfaceLang = (voice) => {
  const lang = voice.lang?.replace('_', '-').toLowerCase() ?? '';
  return IS_ENGLISH ? lang.startsWith('en') : lang === 'pt-br';
};

/** Melhor voz instalada no idioma da interface, ou null (o navegador usa a padrão). */
function bestSystemVoice(synth) {
  const voices = synth.getVoices().filter(speaksInterfaceLang);
  for (const rank of VOICE_RANKS) {
    const found = voices.find((voice) => rank.test(voice.name));
    if (found) return found;
  }
  return voices[0] ?? null;
}

export function createAudio() {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let context = null;
  let soundOn = readPref(STORAGE.sound);
  let voiceOn = readPref(STORAGE.voice);
  let speakingPriority = -1;
  let remote = null; // { modelo, voz } quando o servidor local responde
  let lastProbe = -Infinity;
  let request = 0; // numera cada fala; uma resposta de rede atrasada não toca por cima de uma nova
  let pending = null; // AbortController da busca em curso
  let player = null; // { audio, url } da fala local em curso

  /** Pergunta ao servidor local se está de pé. Sem ele, fica a voz do navegador. */
  async function probe() {
    lastProbe = performance.now();
    if (!VOICE_SERVER) return;
    try {
      const response = await fetch(`${VOICE_SERVER}/saude?idioma=${LANG}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const health = await response.json();
      remote = health.ok ? { modelo: health.modelo, voz: health.voz } : null;
    } catch {
      remote = null;
    }
  }
  probe();

  // O contexto de áudio só pode nascer depois de um gesto do usuário (entrar no visor).
  function unlock() {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') context.resume().catch(() => { /* fica mudo até o próximo gesto */ });
    if (!remote && performance.now() - lastProbe > PROBE_RETRY_MS) probe(); // o servidor pode ter subido depois
  }

  /** Toca o padrão sonoro de um nível de alerta. */
  function play(level) {
    if (!soundOn || !context || context.state !== 'running') return;
    const pattern = PATTERNS[level];
    const peak = VOLUME * WAVE_GAIN[pattern.wave];
    for (const [frequency, startS, durationS] of pattern.notes) {
      const at = context.currentTime + startS;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = pattern.wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + ATTACK_S);
      gain.gain.linearRampToValueAtTime(0, at + durationS);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + durationS + 0.02);
    }
  }

  function stopPlayer() {
    pending?.abort();
    pending = null;
    if (!player) return;
    player.audio.pause();
    URL.revokeObjectURL(player.url);
    player = null;
  }

  function speakWithSystem(text, priority) {
    if (!synth) return;
    if (synth.speaking && priority < speakingPriority) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = HTML_LANG;
    utterance.voice = bestSystemVoice(synth);
    utterance.rate = SYNTH_RATE;
    utterance.onend = () => { speakingPriority = -1; };
    utterance.onerror = () => { speakingPriority = -1; };
    speakingPriority = priority;
    synth.speak(utterance);
  }

  async function speakWithServer(text, priority) {
    stopPlayer();
    const mine = ++request;
    const controller = new AbortController();
    pending = controller;
    speakingPriority = priority;
    try {
      const response = await fetch(`${VOICE_SERVER}/falar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sem `voz`: o servidor escolhe a voz pelo idioma (uma voz pedida aqui passaria por cima dele).
        body: JSON.stringify({ texto: text, idioma: LANG }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`servidor de voz: ${response.status}`);
      const blob = await response.blob();
      if (mine !== request) return; // chegou depois de uma fala mais nova (ou do silêncio)
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const finish = () => {
        if (player?.audio !== audio) return;
        stopPlayer();
        speakingPriority = -1;
      };
      audio.onended = finish;
      audio.onerror = finish;
      pending = null;
      player = { audio, url };
      await audio.play();
    } catch (error) {
      if (mine !== request || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') { // o navegador pede um gesto antes de tocar; o servidor está bem
        stopPlayer();
        speakingPriority = -1;
        return;
      }
      console.warn('Guardião: voz local falhou, usando a voz do navegador.', error);
      remote = null;
      stopPlayer();
      speakingPriority = -1;
      speakWithSystem(text, priority);
    }
  }

  /** Fala uma frase. Só interrompe a fala em curso se a nova for de prioridade igual ou maior. */
  function speak(text, priority) {
    if (!voiceOn) return;
    const spoken = toSpeech(text);
    if (remote) {
      if (speakingPriority >= 0 && priority < speakingPriority) return;
      speakWithServer(spoken, priority);
      return;
    }
    speakWithSystem(spoken, priority);
  }

  function silence() {
    request += 1; // invalida qualquer áudio ainda a caminho
    stopPlayer();
    synth?.cancel();
    speakingPriority = -1;
  }

  // O áudio roda dentro do laço de quadros: uma falha aqui não pode derrubar o visor.
  // Em vez de propagar, avisa no console e desliga o recurso que falhou.
  const guarded = (action, disable) => (...args) => {
    try {
      action(...args);
    } catch (error) {
      console.warn('Guardião: áudio indisponível, recurso desligado.', error);
      disable();
    }
  };

  return Object.freeze({
    unlock: guarded(unlock, () => { soundOn = false; }),
    play: guarded(play, () => { soundOn = false; }),
    speak: guarded(speak, () => { voiceOn = false; }),
    silence,
    get hasVoice() { return remote !== null || synth !== null; },
    get voiceInfo() {
      if (remote) {
        const model = remote.modelo.replace(/-\d+M$/, '');
        return IS_LOCAL_PAGE ? t`voz neural local · ${model} (${remote.voz})` : t`voz neural · ${model} (${remote.voz})`;
      }
      const voice = synth ? bestSystemVoice(synth) : null;
      return voice ? t`voz do sistema · ${voice.name}` : t`voz do sistema`;
    },
    get soundOn() { return soundOn; },
    get voiceOn() { return voiceOn; },
    toggleSound() { soundOn = !soundOn; writePref(STORAGE.sound, soundOn); },
    toggleVoice() { voiceOn = !voiceOn; writePref(STORAGE.voice, voiceOn); if (!voiceOn) silence(); },
  });
}
