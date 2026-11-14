// Som dos alertas (Web Audio) e voz do assistente (speechSynthesis), cada um com a
// própria chave de liga e desliga. A preferência fica guardada no navegador.

const STORAGE = Object.freeze({ sound: 'guardiao:som', voice: 'guardiao:voz' });
const VOLUME = 0.09;
const ATTACK_S = 0.012;

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

// Texto para a voz: símbolos e abreviações viram palavras.
function toSpeech(text) {
  return text
    .replaceAll('O₂', 'oxigênio')
    .replaceAll('µSv/h', 'microsieverts por hora')
    .replaceAll('µSv', 'microsieverts')
    .replaceAll('%/h', 'por cento por hora')
    .replaceAll('m/s', 'metros por segundo')
    .replaceAll('kPa', 'quilopascais')
    .replaceAll('×', ' vezes')
    .replaceAll('·', ',')
    .replace(/(\d+)h(\d\d)/g, (_, hours, mins) => (hours === '0' ? `${Number(mins)} minutos` : `${hours} hora${hours === '1' ? '' : 's'} e ${Number(mins)} minutos`));
}

export function createAudio() {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let context = null;
  let soundOn = readPref(STORAGE.sound);
  let voiceOn = readPref(STORAGE.voice);
  let speakingPriority = -1;

  // O contexto de áudio só pode nascer depois de um gesto do usuário (entrar no visor).
  function unlock() {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') context.resume().catch(() => { /* fica mudo até o próximo gesto */ });
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

  /** Fala uma frase. Só interrompe a fala em curso se a nova for de prioridade igual ou maior. */
  function speak(text, priority) {
    if (!voiceOn || !synth) return;
    if (synth.speaking && priority < speakingPriority) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(toSpeech(text));
    utterance.lang = 'pt-BR';
    utterance.rate = 1.1;
    utterance.onend = () => { speakingPriority = -1; };
    utterance.onerror = () => { speakingPriority = -1; };
    speakingPriority = priority;
    synth.speak(utterance);
  }

  function silence() {
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
    hasVoice: synth !== null,
    get soundOn() { return soundOn; },
    get voiceOn() { return voiceOn; },
    toggleSound() { soundOn = !soundOn; writePref(STORAGE.sound, soundOn); },
    toggleVoice() { voiceOn = !voiceOn; writePref(STORAGE.voice, voiceOn); if (!voiceOn) silence(); },
  });
}
