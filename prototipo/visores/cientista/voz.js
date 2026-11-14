// Voz do assistente: fala com speechSynthesis e, onde o navegador oferece, escuta com
// reconhecimento de fala. Tudo opcional: sem suporte, as funções apenas não fazem nada.
// Independente do HUD: só usa as APIs de voz do navegador (`toSpeech` é pura).

const LANG = 'pt-BR';

function durationWords(_match, hours, minutes) {
  const mins = `${Number(minutes)} minutos`;
  if (hours === '0') return mins;
  return `${hours} ${hours === '1' ? 'hora' : 'horas'} e ${mins}`;
}

// Símbolos do HUD que a síntese de voz leria errado.
const SPEECH_FIXES = Object.freeze([
  [/O₂/g, 'oxigênio'],
  [/µSv\/h/g, 'microsieverts por hora'],
  [/µSv/g, 'microsieverts'],
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

export function createVoice() {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  let speaking = false;
  let recognition = null;

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
  }

  /**
   * Escuta uma frase.
   * @param {{ onText: (text: string) => void, onEnd: () => void, onError: (reason: string) => void }} handlers
   * @returns {boolean} false se não houver reconhecimento de fala.
   */
  function listen({ onText, onEnd, onError }) {
    if (!Recognition) return false;
    stopListening();
    synth?.cancel();
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
    return true;
  }

  return Object.freeze({
    canSpeak: Boolean(synth),
    canListen: Boolean(Recognition),
    isSpeaking: () => speaking,
    speak,
    setSpeaking,
    listen,
    stopListening,
  });
}
