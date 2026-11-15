// Motor de resposta do visor único: a IA de bordo (src/ia), com as ordens diretas atendidas na hora.
//
// - Ordem direta que as regras reconhecem (confirmar o passo do protocolo, abortar, pausar, relatar
//   perigo, registrar amostra) é executada sem esperar o modelo: comando de segurança não pode demorar.
// - Todo o resto vai para o modelo de linguagem, que responde só com os dados da saída.
// - Se o modelo não responder, a conversa diz isso e ensina a resolver. Nada é respondido
//   "de mentira" no lugar dele; alertas e protocolos do visor seguem por regras fixas.

import { createAgent, engineLabel, offlineMessage } from '../../src/ia/agente.js';
import { createVisorTools, VISOR_PROMPT, VISOR_EXAMPLES } from '../../src/ia/ferramentas-visor.js';
import { answerUnified } from './contexto.js';

// Perguntas rápidas que são comandos do protocolo em condução: ficam na frente dos exemplos.
const PROTOCOL_COMMANDS = new Set(['feito', 'abortar', 'seguir', 'repetir o passo', 'encerrar emergência']);

const offlineText = (health) => `${offlineMessage(health)} Os alertas e os protocolos do visor continuam funcionando sem ela.`;

/**
 * @param {{
 *   getContext: () => object | null, getSession: () => object,
 *   safety: object, live: () => object, runAction: (action: { type: string }) => void,
 *   onStatus: (text: string | null) => void, onHealth: () => void,
 * }} deps `onStatus` recebe o que a IA está fazendo; `onHealth` avisa que o estado dela mudou.
 */
export function createAssistantEngine({ getContext, getSession, safety, live, planIn, tripTo, runAction, terrain, onStatus, onHealth }) {
  const visorTools = createVisorTools({ getContext, getSession, safety, live, planIn, tripTo, runAction, terrain });
  const agent = createAgent({ tools: visorTools.tools, snapshot: visorTools.snapshot, retrieve: visorTools.retrieve, systemPrompt: VISOR_PROMPT, onStatus });
  // Fila: uma pergunta feita enquanto outra ainda é respondida espera a vez, para as conversas não se misturarem.
  let queue = Promise.resolve();
  let health = { ok: false, reason: 'verificando', where: agent.where, model: agent.model };

  async function check() {
    health = await agent.health();
    onHealth();
    return health;
  }

  /** Motor para `createConversation({ engine })`. */
  async function engine(question, context) {
    const direct = answerUnified(question, context);
    if (direct.action) return direct;
    const turn = queue.then(() => agent.ask(question));
    queue = turn.catch(() => {});
    try {
      const reply = await turn;
      if (!health.ok) { health = { ok: true, where: agent.where, model: agent.model }; onHealth(); }
      return { intent: 'ia', text: reply.text, action: null };
    } catch (error) {
      console.warn(error);
      // Na nuvem a checagem só vê se há chave; a pergunta que falhou é que diz que ela não respondeu.
      const checked = await agent.health();
      health = checked.where === 'nuvem' ? { ...checked, ok: false, reason: 'sem-resposta', detail: error instanceof Error ? error.message : '' } : checked;
      onHealth();
      return { intent: 'ia-fora-do-ar', text: offlineText(health), action: null };
    }
  }

  return Object.freeze({
    engine,
    check,
    reset: () => { agent.reset(); visorTools.clearPins(); },
    /** Leituras que a IA fixou no visor, com o valor de agora. */
    pins: visorTools.pins,
    /** Texto curto para o rótulo do assistente no visor. */
    note: () => (health.ok ? engineLabel(health) : health.reason === 'verificando' ? 'IA de bordo · verificando…' : 'IA de bordo fora do ar · alertas por regras'),
    intro: () => (health.ok
      ? 'IA de bordo pronta. Respondo só com os dados desta saída; os alertas e os protocolos seguem regras fixas.'
      : 'Os alertas e os protocolos estão ativos. A IA de bordo ainda não respondeu.'),
    /** Perguntas de exemplo, com os comandos do protocolo em condução na frente. */
    examples: (ruleQuestions) => [...ruleQuestions.filter(([, question]) => PROTOCOL_COMMANDS.has(question)), ...VISOR_EXAMPLES],
  });
}
