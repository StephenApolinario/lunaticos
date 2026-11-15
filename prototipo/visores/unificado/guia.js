// Adaptadores puros entre a sessão do Guardião e as peças do Navegador e do Cientista:
// o que a guia no chão deve mostrar, a frase padrão do assistente, o texto do rádio à frente
// e o perigo relatado dentro da pilha de alertas do Guardião. Roda no Node (ver check.mjs).

import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { levelOrder, RULES } from '../guardiao/catalog.js';
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
  const howFar = target.timeOnly ? fmtDuration(target.etaH) : fmtDistance(target.distM);
  return target.kind === 'shelter' ? t`Abrigo · ${target.name} · ${howFar}` : `${target.name} · ${howFar}`;
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
  if (backToRoute) point = { ...rejoin, label: t`Retomar a rota` };
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

/** Quando o rádio muda seguindo a rota, em uma frase inteira, a partir de `radioReading` (../navegador/leitura.js). */
export function radioAheadText({ route }) {
  if (route.changeInM === null) return t`Seguindo a rota, o sinal não muda até o fim da rota.`;
  const changeIn = fmtDistance(route.changeInM);
  if (!route.visible) return t`Seguindo a rota, o sinal volta em ${changeIn}.`;
  const length = fmtDistance(route.nextLengthM);
  return route.nextLengthM < NAV.radioMinGapM
    ? t`Seguindo a rota, o sinal tem um corte curto em ${changeIn}, por ${length}.`
    : t`Seguindo a rota, o sinal cai em ${changeIn}, por ${length}.`;
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
    title: t`Perigo relatado por perto`,
    cause: `${warning.text}.`,
    effect: t`Não está nos dados da rota: veio do relato de um astronauta, guardado neste navegador.`,
    action: warning.action,
    raisedH: clockH,
    ack: acked.has(warning.key),
  };
  // Depois dos alertas do mesmo nível ou mais graves; antes dos de informação.
  const at = active.findIndex((other) => levelOrder(other.level) < levelOrder(REPORT_LEVEL));
  return at < 0 ? [...active, alert] : [...active.slice(0, at), alert, ...active.slice(at)];
}

export const isReportedHazard = (id) => id.startsWith('perigo-relatado:');

const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;
// A leitura que explica cada alerta do Guardião (../guardiao/rules.js): [rótulo, valor, nota curta].
const ALERT_READINGS = Object.freeze({
  solar: (r) => [t`Radiação`, `${fmtNumber(r.radiationRate)} µSv/h`, t`${fmtNumber(r.fx.radFactor)}× o normal`],
  poeira: (r) => [t`Poeira`, r.fx.dust.arrived ? t`chegou` : t`em ${minutes(r.fx.dust.etaH)}`, t`frente de poeira`],
  frio: (r) => [t`Temperatura`, `${fmtNumber(r.airTempC)} °C`, t`mínimo do traje ${RULES.suitMinTempC} °C`],
  'frio-a-caminho': (r) => [t`Temperatura`, `${fmtNumber(r.airTempC)} °C`, t`frio em ${minutes(r.coldInH)}`],
  vento: (r) => [t`Vento`, `${fmtNumber(r.windMps)} m/s`, t`rajadas`],
  radio: (r) => [t`Rádio`, t`sem resposta`, t`há ${minutes(r.radio.lostH)}`],
  veiculo: () => [t`Veículo`, t`em pane`, t`a volta é a pé`],
  traje: (r) => [t`Integridade`, `${fmtNumber(r.integrityPct)}%`, t`vaza ${fmtNumber(r.leakPctH, 1)} %/h de O₂`],
  o2: (r) => [t`O₂ acaba em`, fmtDuration(r.o2AutonomyH), t`neste ritmo`],
  'o2-plano': (r) => [t`O₂ no fim`, r.o2EndPct < 0 ? t`não cobre` : `${fmtNumber(Math.round(r.o2EndPct))}%`, t`no fim do plano`],
  pnr: (r) => (r.pnr.status === 'ahead' ? [t`Sem retorno`, fmtDistance(r.pnr.aheadM), t`à frente`] : [t`Sem retorno`, t`passou`, t`ponto ultrapassado`]),
  declive: (r) => [t`Declive`, `${fmtNumber(r.slopeAheadDeg)}°`, t`à frente`],
  rochas: (r) => [t`Rochas`, fmtDistance(Math.max(0, r.hazard.edgeM)), r.hazard.side],
  bateria: (r) => [t`Bateria acaba em`, fmtDuration(r.batteryPct / r.batteryRatePctH), t`neste ritmo`],
  dose: (r) => [t`Dose`, `${fmtNumber(r.doseUsv)} µSv`, t`limite de ${fmtNumber(RULES.doseLimitUsv)}`],
});

/**
 * A leitura que explica um alerta, para o bloco de alerta do visor.
 * @param {{ id: string }|undefined} alert O alerta mais grave do momento.
 * @param {object} r Leitura do quadro do Guardião.
 * @returns {{ label: string, value: string, note: string }|null} null se o alerta não tem uma leitura só dele.
 */
export function alertReading(alert, r) {
  if (!alert) return null;
  if (isReportedHazard(alert.id)) return { label: t`Perigo relatado`, value: t`por perto`, note: t`relato de astronauta` };
  if (!Object.hasOwn(ALERT_READINGS, alert.id)) return null;
  const [label, value, note] = ALERT_READINGS[alert.id](r);
  return { label, value, note };
}
