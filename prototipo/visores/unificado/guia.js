// Adaptadores puros entre a sessão do Guardião e as peças do Navegador e do Cientista:
// o que a guia no chão deve mostrar, a frase padrão do assistente, o texto do rádio à frente
// e o perigo relatado dentro da pilha de alertas do Guardião. Roda no Node (ver check.mjs).

import { fmtDistance, fmtDuration } from '../../src/format.js';
import { levelOrder } from '../guardiao/catalog.js';
import { nextManeuver } from '../navegador/analise.js';
import { routeInstruction } from '../navegador/assistente.js';
import { NAV } from '../navegador/leitura.js';

const TURN_MARK_PASSED_M = 20;
const REPORT_LEVEL = 'atencao';
// Um aviso preventivo do Guardião fica na linha do assistente por este tempo (segundos de relógio).
export const ADVICE_HOLD_S = 8;
// Assuntos do Guardião que entram no histórico da conversa: protocolo, alerta, aviso preventivo,
// fim da saída e abrigo. A frase de rota e a de coleta só aparecem na linha do assistente.
const LOGGED = /^(p:|a:|aviso:|fim$|abrigado$)/;

/** Rótulo do alvo atual (pino da cena e indicador de borda), a partir da leitura do Guardião. */
export function targetLabel({ target }) {
  if (target.kind === 'dwell' || target.kind === 'home') return target.name;
  const prefix = target.kind === 'shelter' ? 'Abrigo · ' : '';
  return `${prefix}${target.name} · ${target.timeOnly ? fmtDuration(target.etaH) : fmtDistance(target.distM)}`;
}

/**
 * O que a guia do Navegador deve mostrar para o estado atual da sessão do Guardião.
 * Seguindo o plano: divisas até a próxima parada e a instrução passo a passo. Parado, em coleta
 * ou voltando pela rota: sem divisas (elas só apontam no sentido do plano). Fora da rota: a linha
 * tracejada até o abrigo no relevo ou até o ponto de retomada.
 * @param {object} analysis De `analyzePlan` (../navegador/analise.js).
 * @param {object} session Sessão do Guardião com a leitura `r` do quadro.
 * @returns {{ following: boolean, instruction: object|null, limitM: number, maneuver: object|null,
 *   rejoin: { x: number, z: number }|null, point: { x: number, z: number, label: string }|null }}
 */
export function guideFor(analysis, session) {
  const { plan, state, r } = session;
  const following = state.nav.kind === 'plan' && !state.finished && !state.off && !r.dwell;
  const nextStop = plan.stops[state.stopsReached];
  const toTerrain = state.nav.kind === 'goto' && state.nav.target.kind === 'terrain';
  let rejoin = null;
  if (toTerrain) rejoin = { x: state.nav.target.x, z: state.nav.target.z };
  else if (state.off && state.nav.kind !== 'hold') rejoin = { x: r.m.here.x, z: r.m.here.z };

  const atTarget = r.finished || r.target.kind === 'dwell' || r.target.kind === 'home' || r.sheltered;
  const backToRoute = rejoin && !toTerrain;
  let point = null;
  if (backToRoute) point = { ...rejoin, label: 'Retomar a rota' };
  else if (!atTarget) point = { x: r.target.position.x, z: r.target.position.z, label: targetLabel(r) };

  return {
    following,
    instruction: following ? routeInstruction(analysis, state.distM, r.target, !r.m.driving) : null,
    limitM: following ? (nextStop ? nextStop.distM : plan.path.totalM) : state.distM,
    maneuver: following ? nextManeuver(analysis, state.distM, TURN_MARK_PASSED_M) : null,
    rejoin,
    point,
  };
}

/** Quando o rádio muda seguindo a rota, a partir de `radioReading` (../navegador/leitura.js). */
export function radioAheadText({ route }) {
  if (route.changeInM === null) return 'não muda até o fim da rota';
  if (!route.visible) return `volta em ${fmtDistance(route.changeInM)}`;
  const short = route.nextLengthM < NAV.radioMinGapM;
  return `${short ? 'tem um corte curto' : 'cai'} em ${fmtDistance(route.changeInM)}, por ${fmtDistance(route.nextLengthM)}`;
}

/**
 * A frase da linha do assistente. Vale a do Guardião (protocolo, alerta, abrigo, coleta). Quando
 * ele só teria "seguro, siga", entra a instrução passo a passo do Navegador; um aviso preventivo
 * do Guardião aparece por alguns segundos e depois devolve a linha à instrução.
 * @param {{ key: string, priority: number, text: string }} message De `assistantMessage` (../guardiao/rules.js).
 * @param {{ key: string, text: string }|null} instruction De `guideFor`.
 * @param {number} ageS Há quantos segundos de relógio o assunto do Guardião é o mesmo.
 * @returns {{ key: string, priority: number, text: string, logged: boolean }}
 *   `logged`: se a frase entra no histórico da conversa quando o assunto muda.
 */
export function voiceLine(message, instruction, ageS) {
  const routine = message.key.startsWith('ok:') || (message.key.startsWith('aviso:') && ageS > ADVICE_HOLD_S);
  if (instruction && routine) return { key: `guia:${instruction.key}`, priority: 0, text: instruction.text, logged: false };
  return { ...message, logged: LOGGED.test(message.key) };
}

/**
 * Põe o aviso de perigo relatado (../cientista/perigos.js, `hazardWarning`) na lista de alertas
 * do Guardião, como atenção, para ele aparecer na mesma pilha e na mesma linha de estado.
 * @param {ReadonlyArray<object>} active Alertas ativos do Guardião, já em ordem de prioridade.
 * @param {{ key: string, text: string, action: string }|null} warning
 * @param {ReadonlySet<string>} acked Chaves de avisos já reconhecidos.
 * @param {number} clockH Hora da missão.
 */
export function withReportedHazard(active, warning, acked, clockH) {
  if (!warning) return active;
  const alert = {
    id: warning.key,
    level: REPORT_LEVEL,
    title: 'Perigo relatado por perto',
    cause: `${warning.text}.`,
    effect: 'Não está nos dados da rota: veio do relato de um astronauta, guardado neste navegador.',
    action: warning.action,
    raisedH: clockH,
    ack: acked.has(warning.key),
  };
  // Depois dos alertas do mesmo nível ou mais graves; antes dos de informação.
  const at = active.findIndex((other) => levelOrder(other.level) < levelOrder(REPORT_LEVEL));
  return at < 0 ? [...active, alert] : [...active.slice(0, at), alert, ...active.slice(at)];
}

export const isReportedHazard = (id) => id.startsWith('perigo-relatado:');
