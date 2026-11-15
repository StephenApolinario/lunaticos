// Conversa com o assistente: liga o motor (assistente.js), a voz (voz.js, opcional) e quem
// mostra as mensagens. Não conhece o HUD nem o DOM: tudo entra por parâmetro, e os comandos
// reconhecidos voltam para quem hospeda executar.

import { fmtDuration } from '../../src/format.js';
import { askAssistant } from './assistente.js';

const MAX_QUESTION_CHARS = 240;
const MIC_ERRORS = Object.freeze({
  'not-allowed': 'O navegador bloqueou o microfone. Libere o acesso ou use o teclado.',
  'no-speech': 'Não ouvi nada. Tente de novo ou use o teclado.',
  'sem-escuta': 'A escuta por voz não está ligada neste computador. Use o teclado.',
});
const MIC_FALLBACK = 'Não consegui usar o microfone. Use o teclado.';

/**
 * @param {{
 *   getContext: () => (import('./assistente.js').AssistantContext | null),
 *   onMessage: (message: { from: 'user'|'assistant'|'alert', text: string, stamp: string }) => void,
 *   onAction: (action: { type: string }) => void,
 *   voice?: ReturnType<typeof import('./voz.js').createVoice> | null,
 *   onVoiceChange?: (state: { canSpeak: boolean, canListen: boolean, speaking: boolean, listening: string|null }) => void,
 *   engine?: (question: string, context: object) => object | Promise<object>,
 * }} deps
 *   `getContext`: contexto atual da saída. `onMessage`: cada fala, para a tela mostrar.
 *   `onAction`: comando reconhecido (relatar perigo, registrar amostra…), que quem hospeda valida e executa.
 *   `engine`: motor de resposta; sem ele, valem as regras.
 */
export function createConversation({ getContext, onMessage, onAction, voice = null, onVoiceChange = () => {}, engine }) {
  let listening = null;

  const stamp = () => fmtDuration(getContext()?.elapsedH ?? 0);
  const voiceState = () => ({
    canSpeak: Boolean(voice?.canSpeak),
    canListen: Boolean(voice?.canListen),
    speaking: Boolean(voice?.isSpeaking()),
    listening,
  });

  /** Fala do assistente: vai para a tela e, com a voz ligada, é dita em voz alta. */
  function say(text, from = 'assistant') {
    onMessage({ from, text, stamp: stamp() });
    voice?.speak(text);
  }

  /** Pergunta digitada ou ditada: mostra, responde e devolve a ação, se houver. */
  async function ask(rawQuestion) {
    const question = String(rawQuestion ?? '').trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) return;
    onMessage({ from: 'user', text: question, stamp: stamp() });
    try {
      const reply = await askAssistant(question, getContext(), engine);
      if (reply?.text) say(String(reply.text));
      if (reply?.action?.type) onAction(reply.action);
    } catch (error) {
      console.error(error);
      say('O assistente falhou ao responder. Tente de novo.', 'alert');
    }
  }

  /**
   * Liga ou desliga a escuta. `target` nomeia quem está ouvindo (para o botão certo mostrar
   * "Ouvindo…"); `onText` recebe a frase reconhecida.
   */
  function listen(target, onText) {
    if (!voice) return;
    if (listening) {
      voice.stopListening();
      return;
    }
    listening = target;
    const started = voice.listen({
      onText,
      // A escuta acabou antes do aviso: quem cala a voz enquanto o microfone está aberto pode dizê-lo.
      onError: (reason) => { listening = null; if (reason !== 'aborted') say(MIC_ERRORS[reason] ?? MIC_FALLBACK, 'alert'); },
      onEnd: () => { listening = null; onVoiceChange(voiceState()); },
    });
    if (!started) listening = null;
    onVoiceChange(voiceState());
  }

  function toggleSpeaking() {
    if (!voice) return;
    voice.setSpeaking(!voice.isSpeaking());
    onVoiceChange(voiceState());
    voice.speak('Voz ligada.');
  }

  /** Cala e para de ouvir (ao sair do visor). */
  function stop() {
    voice?.stopListening();
    voice?.setSpeaking(false);
    listening = null;
    onVoiceChange(voiceState());
  }

  return Object.freeze({ ask, say, listen, toggleSpeaking, stop, voiceState });
}
