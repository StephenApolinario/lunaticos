// Motor de regras do Guardião: transforma a leitura do instante em alertas (causa,
// consequência, ação), na linha de estado e na fala do assistente.
// É um conjunto fixo de regras, não um modelo de linguagem: a interface o rotula como simulado.

import { earthEquivalentWindKmh } from '../../src/clima.js';
import { SIM } from '../../src/simulation.js';
import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { RULES, FAULTS, LEVELS, PROTOCOLS, SHELTER_PHRASES, levelOrder } from './catalog.js';

const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;

/** Tempo de caminhada. Sem caminho a pé conhecido, o roteador devolve infinito. */
export const fmtWalk = (hours) => (Number.isFinite(hours) ? fmtDuration(hours) : 'sem caminho a pé');

// Onde fica um abrigo: distância quando ela é conhecida, senão só o tempo de caminhada.
const whereText = (pick) => (pick.distM === null ? `a ${fmtWalk(pick.timeH)} ${pick.dirText}` : `a ${fmtDistance(pick.distM)} ${pick.dirText}, ${fmtDuration(pick.timeH)}`);

/** Frase curta com o abrigo recomendado: onde, em quanto tempo e com quanto O₂. */
export function shelterLine(pick) {
  if (!pick) return 'Nenhum abrigo ao alcance do O₂: pare, poupe oxigênio e peça resgate.';
  if (pick.distM !== null && pick.distM < 1) return `${pick.name}: ${pick.dirText}.`;
  return `${pick.name} ${whereText(pick)}. O₂ chega com ${pct(pick.o2AfterPct)}.${pick.provisional ? ' Abrigo provisório.' : ''}`;
}

/** Texto do passo "ir ao abrigo" de um protocolo. */
export function goStepText(pick) {
  if (!pick) return 'Nenhum abrigo ao alcance do O₂. Fique parado, poupe oxigênio e peça resgate.';
  if (pick.distM !== null && pick.distM < 1) return `Abrigue-se n${SHELTER_PHRASES[pick.kind]}: ${pick.dirText}.`;
  return `Vá para ${SHELTER_PHRASES[pick.kind]}, ${whereText(pick)}.`;
}

// Volta a pé ao habitat em uma frase.
const walkBackText = (r) => (Number.isFinite(r.ret.timeH) ? `${fmtDuration(r.ret.timeH)} de caminhada, chegando com ${pct(r.ret.o2AfterPct)} de O₂` : 'não há caminho a pé conhecido até o habitat');

/**
 * Condições de alerta verdadeiras neste instante.
 * @returns {Array<{ id: string, level: string, title: string, cause: string, effect: string, action: string }>}
 */
// Alertas que só aparecem quando alguém dispara um cenário de emergência na barra do visor.
// O texto deles avisa que é cenário simulado, para o número não passar por leitura real.
const SCENARIO_ALERTS = new Set(['solar', 'poeira', 'vento', 'radio', 'veiculo', 'traje']);
const SCENARIO_NOTE = 'Cenário de treino.';

export function detect(r) {
  const out = [];
  const add = (id, level, title, cause, effect, action) => out.push({ id, level, title, cause, effect, action });
  // Abrigado, o nível cai: proteção total vira informação, parcial vira atenção.
  const level = (base, full, partial = []) => (full.includes(r.sheltered) ? 'info' : partial.includes(r.sheltered) ? 'atencao' : base);
  const carOk = r.m.vehicleM !== null && !r.m.vehicleDown;
  const exposed = !r.sheltered && !r.finished;

  if (r.fx.radFactor > 1) {
    let effect = 'A dose da saída já passou do limite.';
    if (r.doseEtaH > 0) effect = `${r.sheltered ? 'Mesmo abrigado' : 'Sem abrigo'}, a dose da saída chega ao limite em ${fmtDuration(r.doseEtaH)}.`;
    add('solar', level('emergencia', ['habitat'], ['vehicle', 'terrain']), 'Evento solar',
      `Radiação em ${fmtNumber(r.radiationRate)} µSv/h. Lá fora está ${r.fx.radFactor}× acima do normal.`, effect,
      r.sheltered ? 'Fique onde está até o fim do evento.' : `Abrigue-se já. ${shelterLine(r.picks.solar)}`);
  }

  if (r.fx.dust) {
    const { etaH, arrived } = r.fx.dust;
    add('poeira', level(arrived ? 'emergencia' : 'perigo', ['habitat', 'vehicle'], ['terrain']), 'Tempestade de poeira',
      arrived ? `A frente de poeira chegou. Visibilidade abaixo de ${fmtNumber(FAULTS.dustVisibilityM / 1000)} km, como medido na tempestade de 2018.` : `Frente de poeira prevista para daqui a ${minutes(etaH)}.`,
      'O horizonte e os pontos de referência somem, e a luz do Sol cai mais de 90%: os painéis quase não carregam.',
      r.sheltered ? 'Fique abrigado até a frente passar.' : `${arrived ? 'Abrigue-se já.' : 'Chegue ao abrigo antes da frente.'} ${shelterLine(r.picks.poeira)}`);
  }

  if (r.airTempC < RULES.suitMinTempC) {
    let action = 'Siga sem paradas longas e vigie a bateria.';
    if (r.batteryEndPct < RULES.batteryDangerPct) action = `Encurte a saída. ${shelterLine(r.picks.frio)}`;
    if (r.sheltered) action = 'Fique abrigado até a temperatura voltar à faixa.';
    add('frio', level('perigo', ['habitat', 'vehicle']), 'Frio abaixo da faixa do traje',
      `Ar a ${fmtNumber(r.airTempC)} °C${r.fx.tempOffsetC < 0 ? ', o mais frio já medido pelo REMS' : ''}. O mínimo do traje é ${RULES.suitMinTempC} °C.`,
      `Aquecimento no máximo: a bateria cai ${fmtNumber(r.batteryRatePctH)} %/h.`, action);
  } else if (r.coldInH !== null) {
    // Aviso antes do problema: o frio ainda não chegou, mas chega dentro do prazo de `coldAdviseH`.
    add('frio-a-caminho', level('atencao', ['habitat', 'vehicle']), 'Frio chegando',
      `Em ${minutes(r.coldInH)} o ar cai abaixo do mínimo do traje (${RULES.suitMinTempC} °C).`,
      'Com o frio o aquecimento vai ao máximo e a bateria cai mais rápido.',
      r.sheltered ? 'Fique abrigado.' : `Esteja abrigado até lá. ${shelterLine(r.picks.frio)}`);
  }

  if (r.windMps >= RULES.windCautionMps) {
    const rough = r.slopeAheadDeg >= RULES.slopeCautionDeg || r.hazard.near;
    let action = 'Passo curto, equipamento preso, longe de encostas.';
    if (rough) action = `Não entre no trecho à frente. ${shelterLine(r.picks.vento)}`;
    if (r.sheltered) action = 'Fique abrigado até as rajadas baixarem.';
    add('vento', level(r.windMps >= RULES.windDangerMps ? 'perigo' : 'atencao', ['habitat', 'vehicle', 'terrain']), 'Vento forte',
      `Rajadas de ${fmtNumber(r.windMps)} m/s, as mais fortes publicadas para Marte.`,
      `No ar rarefeito, empurram como um vento de ${fmtNumber(earthEquivalentWindKmh(r.windMps))} km/h na Terra: não derrubam. O risco é a poeira levantada tirar a visão do chão.`, action);
  }

  if (r.radio.state === 'lost') {
    const over = r.radio.lostH >= RULES.radioSilenceLimitH;
    add('radio', r.sheltered === 'habitat' ? 'info' : over ? 'perigo' : 'atencao', 'Rádio sem resposta',
      `O rádio do traje não responde há ${minutes(r.radio.lostH)}.`, 'Ninguém acompanha sua telemetria nem orienta um resgate.',
      over ? `Limite de silêncio atingido: volte ao habitat. ${shelterLine(r.picks.radio)}`
        : `Canal reserva e linha de visada. Com ${minutes(RULES.radioSilenceLimitH)} sem enlace, a regra é voltar.`);
  } else if (r.radio.state === 'shadow' && exposed) {
    // Trecho sem visada é previsto no plano: informa, não interrompe.
    add('sombra', 'info', 'Sem visada direta com o habitat', 'O relevo está entre você e o mastro do habitat.',
      r.comms.gapLeftM > 0 ? `Sem rádio direto pelos próximos ${fmtDistance(r.comms.gapLeftM)} de rota.` : 'Sem rádio direto neste ponto.',
      'Trecho previsto no plano. Eu registro a telemetria e envio quando o enlace voltar.');
  }

  if (r.m.vehicleDown) {
    let action = shelterLine(r.picks.veiculo);
    if (r.sheltered === 'vehicle') action = 'Fique na cabine, poupe O₂ e aguarde o resgate.';
    add('veiculo', level(r.ret.ok ? 'perigo' : 'emergencia', ['habitat'], ['vehicle']), 'Pane do veículo',
      'O veículo perdeu a tração e não responde.',
      r.ret.reaches ? `A volta passa a ser a pé: ${walkBackText(r)}.` : 'A pé, o O₂ não alcança o habitat.', action);
  }

  if (r.integrityPct < 100) {
    add('traje', level(r.leakPctH >= RULES.leakEmergencyPctH ? 'emergencia' : 'perigo', ['habitat', 'vehicle']), 'Traje danificado',
      `Integridade em ${pct(r.integrityPct)}. Vazamento de ${fmtNumber(r.leakPctH, 1)} %/h de O₂.`,
      `Pressão em ${fmtNumber(r.pressureKpa, 1)} kPa. Neste ritmo, o oxigênio acaba em ${fmtDuration(r.o2AutonomyH)}.`,
      r.sheltered ? 'Faça a inspeção completa antes de sair.' : `${r.patched ? 'Selante aplicado.' : 'Aplique o selante.'} Vá a um abrigo pressurizado. ${shelterLine(r.picks.traje)}`);
  }

  const o2Low = r.o2Pct < RULES.o2ReservePct;
  if (o2Low && r.sheltered !== 'habitat') {
    add('o2', level('emergencia', [], ['vehicle']), 'O₂ abaixo da reserva',
      `O₂ em ${pct(r.o2Pct)}. A reserva é de ${RULES.o2ReservePct}%.`, `Neste ritmo, o oxigênio acaba em ${fmtDuration(r.o2AutonomyH)}.`,
      r.sheltered ? 'Reabasteça no veículo antes de sair.' : `Vá à fonte de O₂ mais próxima. ${shelterLine(r.picks.o2)}`);
  }

  // As regras abaixo olham o plano à frente: só valem enquanto ele está sendo seguido.
  if (exposed && r.nav.kind === 'plan') {
    if (!o2Low && r.o2EndPct < 0) {
      let action = shelterLine(r.nearestShelter);
      if (r.ret.reaches) action = `Volte agora: ${walkBackText(r)}.`;
      if (r.pnr.status === 'ahead') action = `Dê meia-volta antes do ponto de não retorno, a ${fmtDistance(r.pnr.aheadM)}.`;
      add('o2-plano', 'perigo', 'O₂ não cobre o plano', 'Neste ritmo, o oxigênio acaba antes do fim da rota.',
        `Faltaria ${fmtDuration(-r.o2EndPct / SIM.o2PctPerHour.foot)} de autonomia.`, action);
    } else if (!o2Low && r.o2EndPct < RULES.o2ReservePct) {
      add('o2-plano', 'atencao', 'Plano termina dentro da reserva', `O₂ previsto na chegada: ${pct(r.o2EndPct)}.`,
        `A reserva de ${RULES.o2ReservePct}% seria usada.`, 'Encurte uma parada ou antecipe o retorno.');
    }

    if (r.pnr.status === 'ahead' && r.pnr.aheadM <= RULES.pnrWarnM) {
      add('pnr', 'atencao', 'Ponto de não retorno próximo', `Faltam ${fmtDistance(r.pnr.aheadM)}, cerca de ${fmtDuration(r.pnr.etaH)}.`,
        carOk ? 'Depois dele, se o veículo quebrar, o O₂ não cobre a volta a pé.' : 'Depois dele, o O₂ não cobre a volta a pé ao habitat.',
        carOk ? 'Confira o veículo antes de cruzar.' : 'Decida agora: dar meia-volta ou encurtar a rota.');
    } else if (r.pnr.status === 'passed') {
      add('pnr', carOk ? 'atencao' : 'perigo', 'Além do ponto de não retorno', 'Daqui, o O₂ não cobre uma volta a pé ao habitat sem usar a reserva.',
        carOk ? 'Você depende do veículo para voltar.' : 'Voltar a pé consome a reserva de O₂.',
        carOk ? 'Fique perto do veículo e vigie o estado dele.' : `Volte já pelo caminho mais rápido: ${walkBackText(r)}.`);
    }

    if (r.moving && r.slopeAheadDeg >= RULES.slopeCautionDeg) {
      add('declive', r.slopeAheadDeg >= RULES.slopeDangerDeg ? 'perigo' : 'atencao', 'Declive forte à frente',
        `Até ${fmtNumber(r.slopeAheadDeg)}° nos próximos ${SIM.slopeLookaheadM} m.`,
        r.m.driving ? 'Risco de o veículo derrapar.' : 'Risco de queda com o peso do traje.',
        r.m.driving ? 'Reduza a velocidade e não pare no meio da rampa.' : 'Passo curto, apoio firme, sem parar no meio da rampa.');
    }
  }

  if (exposed && r.hazard.near) {
    add('rochas', 'atencao', 'Rochas cortantes por perto', `Zona de rochas cortantes a ${fmtDistance(Math.max(0, r.hazard.edgeM))} ${r.hazard.side}.`,
      'Podem cortar luvas e botas do traje.', 'Fique na rota marcada.');
  }

  if (r.sheltered !== 'habitat' && r.batteryPct < RULES.batteryCautionPct) {
    const critical = r.batteryPct < RULES.batteryDangerPct;
    add('bateria', critical ? 'perigo' : 'atencao', critical ? 'Bateria crítica' : 'Bateria baixa', `Bateria em ${pct(r.batteryPct)}.`,
      `Neste ritmo, acaba em ${fmtDuration(r.batteryPct / r.batteryRatePctH)}. Sem ela não há aquecimento, rádio nem visor.`,
      'Desligue o que não for vital e antecipe o retorno.');
  }

  const doseFrac = r.doseUsv / RULES.doseLimitUsv;
  if (doseFrac >= RULES.doseCautionFrac && r.sheltered !== 'habitat') {
    const over = doseFrac >= 1;
    add('dose', over ? 'perigo' : 'atencao', over ? 'Limite de dose da saída atingido' : 'Dose perto do limite',
      `Dose acumulada: ${fmtNumber(r.doseUsv)} de ${fmtNumber(RULES.doseLimitUsv)} µSv.`,
      over ? 'Cada minuto fora soma dose além do planejado.' : `Neste ritmo, o limite chega em ${fmtDuration(r.doseEtaH)}.`,
      over ? 'Encerre a saída e volte ao habitat.' : 'Reduza o tempo exposto e prepare o retorno.');
  }

  if (r.dwell) {
    add('coleta', 'info', `Coleta · parada ${r.dwell.stop.id}`, r.dwell.stop.task, `Faltam ${minutes(r.dwell.remainingH)} de coleta.`,
      'Eu vigio O₂, radiação e o caminho de volta.');
  }
  if (r.finished) {
    add('fim', 'info', 'Saída encerrada no habitat', `Tempo de saída: ${fmtDuration(r.clockH)}.`,
      `Dose: ${fmtNumber(r.doseUsv)} µSv. O₂ final: ${pct(r.o2Pct)}.`, 'Reabasteça e registre a saída.');
  }
  // O frio também acontece sem cenário (antes do amanhecer o ar medido pelo REMS fica abaixo da faixa do traje).
  const isScenario = (alert) => SCENARIO_ALERTS.has(alert.id) || (alert.id === 'frio' && r.fx.tempOffsetC !== 0);
  return out.map((alert) => (isScenario(alert) ? { ...alert, cause: `${SCENARIO_NOTE} ${alert.cause}` } : alert));
}

// Frase de "seguro": responde se dá para voltar a pé daqui.
function safeLine(r) {
  if (r.mode === 'car') return `Se o veículo quebrar aqui, você volta a pé: ${walkBackText(r)}.`;
  return `Volta a pé garantida: ${walkBackText(r)}.`;
}

/** Linha de estado: a resposta curta para "estou seguro?". */
export function statusLine(r, alerts) {
  const top = alerts.find((alert) => levelOrder(alert.level) > 0);
  if (top) return { level: top.level, word: LEVELS[top.level].label, text: `${top.title} · ${top.action}` };
  if (r.finished) return { level: 'seguro', word: 'Seguro', text: 'Saída encerrada no habitat.' };
  if (r.sheltered) return { level: 'seguro', word: 'Seguro', text: 'Abrigado. Aguarde a liberação para retomar a saída.' };
  return { level: 'seguro', word: 'Seguro', text: safeLine(r) };
}

// Avisos antes do problema: aparecem quando nada mais grave está na frente.
function preventive(r) {
  const carOk = r.m.vehicleM !== null && !r.m.vehicleDown;
  if (r.pnr.status === 'ahead' && r.pnr.aheadM <= RULES.pnrAdviseM) {
    return {
      key: 'aviso:pnr',
      text: `Ponto de não retorno em ${fmtDistance(r.pnr.aheadM)}. ${carOk ? 'Antes de cruzar, confira bateria e tração do veículo.' : 'Para prevenir, decida a meia-volta antes dele.'}`,
    };
  }
  if (r.moving && r.slopeAheadDeg >= RULES.slopeAdviseDeg && r.slopeAheadDeg < RULES.slopeCautionDeg) {
    return { key: 'aviso:declive', text: `Rampa de ${fmtNumber(r.slopeAheadDeg)}° logo à frente. Encurte o passo antes de entrar nela.` };
  }
  if (!r.hazard.near && r.hazard.edgeM < RULES.hazardAdviseM) {
    return { key: 'aviso:rochas', text: `Rochas cortantes a ${fmtDistance(r.hazard.edgeM)} ${r.hazard.side}. Não corte caminho por lá.` };
  }
  const gap = r.comms.nextGap;
  if (r.radio.state === 'ok' && gap && gap.aheadM <= RULES.commsAdviseM) {
    return { key: 'aviso:radio', text: `Em ${fmtDistance(gap.aheadM)} você perde a visada com o habitat por ${fmtDistance(gap.lengthM)} de rota. Avise a base antes de entrar.` };
  }
  return null;
}

/**
 * Fala do assistente: uma frase por vez, pela regra de maior prioridade.
 * `key` identifica o assunto (a voz só fala quando ele muda) e `priority` o nível.
 * @param {object|null} proto Protocolo em condução (de `protocolView`), ou null.
 */
export function assistantMessage(r, alerts, proto) {
  if (proto) {
    const head = `${PROTOCOLS[proto.id].name}, passo ${proto.stepNumber} de ${proto.steps.length}.`;
    if (proto.current.type === 'decision') {
      const verdict = proto.recommendation.abort ? 'Recomendo abortar' : 'Recomendo seguir';
      const where = proto.recommendation.abort ? ` ${shelterLine(proto.pick)}` : '';
      return { key: `p:${proto.id}:decisao:${proto.recommendation.abort}`, priority: 3, text: `${verdict}: ${proto.recommendation.why}.${where} A decisão é sua.` };
    }
    return { key: `p:${proto.id}:${proto.stepNumber}`, priority: 3, text: `${head} ${proto.current.text}` };
  }
  const top = alerts.find((alert) => !alert.ack && levelOrder(alert.level) > 0);
  if (top) return { key: `a:${top.id}:${top.level}`, priority: levelOrder(top.level), text: `${top.title}. ${top.action}` };
  if (r.finished) return { key: 'fim', priority: 0, text: `Saída encerrada no habitat. Dose de ${fmtNumber(r.doseUsv)} µSv e O₂ em ${pct(r.o2Pct)}.` };
  if (r.sheltered) return { key: 'abrigado', priority: 0, text: 'Você está abrigado. Aviso quando for seguro retomar a saída.' };
  if (r.dwell) return { key: `coleta:${r.dwell.stop.id}`, priority: 0, text: `Parada ${r.dwell.stop.id}. ${r.dwell.stop.task} Eu vigio O₂, radiação e o caminho de volta.` };
  const advice = preventive(r);
  if (advice) return { ...advice, priority: 1 };
  const next = r.target.kind === 'return' ? `Habitat a ${fmtDistance(r.target.distM)}.` : `${r.target.name} a ${fmtDistance(r.target.distM)}.`;
  return { key: `ok:${r.target.kind}:${r.target.stopId}`, priority: 0, text: `Seguro. ${safeLine(r)} ${next}` };
}
