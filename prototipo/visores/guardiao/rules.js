// Motor de regras do Guardião: transforma a leitura do instante em alertas (causa,
// consequência, ação), na linha de estado e na fala do assistente.
// É um conjunto fixo de regras, não um modelo de linguagem: a interface o rotula como simulado.

import { earthEquivalentWindKmh } from '../../src/clima.js';
import { SIM } from '../../src/simulation.js';
import { fmtDistance, fmtDuration, fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';
import { RULES, FAULTS, LEVELS, PROTOCOLS, SHELTER_PHRASES, levelOrder } from './catalog.js';

const pct = (value) => `${fmtNumber(Math.max(0, value))}%`;
const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;

/** Tempo de caminhada. Sem caminho a pé conhecido, o roteador devolve infinito. */
export const fmtWalk = (hours) => (Number.isFinite(hours) ? fmtDuration(hours) : t`sem caminho a pé`);

// Onde fica um abrigo: distância quando ela é conhecida, senão só o tempo de caminhada.
const whereText = (pick) => (pick.distM === null ? t`a ${fmtWalk(pick.timeH)} ${pick.dirText}` : t`a ${fmtDistance(pick.distM)} ${pick.dirText}, ${fmtDuration(pick.timeH)}`);

/** Frase curta com o abrigo recomendado: onde, em quanto tempo e com quanto O₂. */
export function shelterLine(pick) {
  if (!pick) return t`Nenhum abrigo ao alcance do O₂: pare, poupe oxigênio e peça resgate.`;
  if (pick.distM !== null && pick.distM < 1) return t`${pick.name}: ${pick.dirText}.`;
  if (pick.provisional) return t`${pick.name} ${whereText(pick)}. O₂ chega com ${pct(pick.o2AfterPct)}. Abrigo provisório.`;
  return t`${pick.name} ${whereText(pick)}. O₂ chega com ${pct(pick.o2AfterPct)}.`;
}

/** Texto do passo "ir ao abrigo" de um protocolo. */
export function goStepText(pick) {
  if (!pick) return t`Nenhum abrigo ao alcance do O₂. Fique parado, poupe oxigênio e peça resgate.`;
  if (pick.distM !== null && pick.distM < 1) return t`Abrigue-se n${SHELTER_PHRASES[pick.kind]}: ${pick.dirText}.`;
  return t`Vá para ${SHELTER_PHRASES[pick.kind]}, ${whereText(pick)}.`;
}

// Volta a pé ao habitat em uma frase.
const walkBackText = (r) => (Number.isFinite(r.ret.timeH) ? t`${fmtDuration(r.ret.timeH)} de caminhada, chegando com ${pct(r.ret.o2AfterPct)} de O₂` : t`não há caminho a pé conhecido até o habitat`);

/**
 * Condições de alerta verdadeiras neste instante.
 * @returns {Array<{ id: string, level: string, title: string, cause: string, effect: string, action: string }>}
 */
// Alertas que só aparecem quando alguém dispara um cenário de emergência na barra do visor.
// O texto deles avisa que é cenário simulado, para o número não passar por leitura real.
const SCENARIO_ALERTS = new Set(['solar', 'poeira', 'vento', 'radio', 'veiculo', 'traje']);
const SCENARIO_NOTE = t`Cenário de treino.`;

export function detect(r) {
  const out = [];
  const add = (id, level, title, cause, effect, action) => out.push({ id, level, title, cause, effect, action });
  // Abrigado, o nível cai: proteção total vira informação, parcial vira atenção.
  const level = (base, full, partial = []) => (full.includes(r.sheltered) ? 'info' : partial.includes(r.sheltered) ? 'atencao' : base);
  const carOk = r.m.vehicleM !== null && !r.m.vehicleDown;
  const exposed = !r.sheltered && !r.finished;

  if (r.fx.radFactor > 1) {
    let effect = t`A dose da saída já passou do limite.`;
    if (r.doseEtaH > 0) {
      effect = r.sheltered ? t`Mesmo abrigado, a dose da saída chega ao limite em ${fmtDuration(r.doseEtaH)}.` : t`Sem abrigo, a dose da saída chega ao limite em ${fmtDuration(r.doseEtaH)}.`;
    }
    add('solar', level('emergencia', ['habitat'], ['vehicle', 'terrain']), t`Evento solar`,
      t`Radiação em ${fmtNumber(r.radiationRate)} µSv/h. Lá fora está ${r.fx.radFactor}× acima do normal.`, effect,
      r.sheltered ? t`Fique onde está até o fim do evento.` : t`Abrigue-se já. ${shelterLine(r.picks.solar)}`);
  }

  if (r.fx.dust) {
    const { etaH, arrived } = r.fx.dust;
    let action = arrived ? t`Abrigue-se já. ${shelterLine(r.picks.poeira)}` : t`Chegue ao abrigo antes da frente. ${shelterLine(r.picks.poeira)}`;
    if (r.sheltered) action = t`Fique abrigado até a frente passar.`;
    add('poeira', level(arrived ? 'emergencia' : 'perigo', ['habitat', 'vehicle'], ['terrain']), t`Tempestade de poeira`,
      arrived ? t`A frente de poeira chegou. Visibilidade abaixo de ${fmtNumber(FAULTS.dustVisibilityM / 1000)} km, como medido na tempestade de 2018.` : t`Frente de poeira prevista para daqui a ${minutes(etaH)}.`,
      t`O horizonte e os pontos de referência somem, e a luz do Sol cai mais de 90%: os painéis quase não carregam.`, action);
  }

  if (r.airTempC < RULES.suitMinTempC) {
    let action = t`Siga sem paradas longas e vigie a bateria.`;
    if (r.batteryEndPct < RULES.batteryDangerPct) action = t`Encurte a saída. ${shelterLine(r.picks.frio)}`;
    if (r.sheltered) action = t`Fique abrigado até a temperatura voltar à faixa.`;
    add('frio', level('perigo', ['habitat', 'vehicle']), t`Frio abaixo da faixa do traje`,
      r.fx.tempOffsetC < 0
        ? t`Ar a ${fmtNumber(r.airTempC)} °C, o mais frio já medido pelo REMS. O mínimo do traje é ${RULES.suitMinTempC} °C.`
        : t`Ar a ${fmtNumber(r.airTempC)} °C. O mínimo do traje é ${RULES.suitMinTempC} °C.`,
      t`Aquecimento no máximo: a bateria cai ${fmtNumber(r.batteryRatePctH)} %/h.`, action);
  } else if (r.coldInH !== null) {
    // Aviso antes do problema: o frio ainda não chegou, mas chega dentro do prazo de `coldAdviseH`.
    add('frio-a-caminho', level('atencao', ['habitat', 'vehicle']), t`Frio chegando`,
      t`Em ${minutes(r.coldInH)} o ar cai abaixo do mínimo do traje (${RULES.suitMinTempC} °C).`,
      t`Com o frio o aquecimento vai ao máximo e a bateria cai mais rápido.`,
      r.sheltered ? t`Fique abrigado.` : t`Esteja abrigado até lá. ${shelterLine(r.picks.frio)}`);
  }

  if (r.windMps >= RULES.windCautionMps) {
    const rough = r.slopeAheadDeg >= RULES.slopeCautionDeg || r.hazard.near;
    let action = t`Passo curto, equipamento preso, longe de encostas.`;
    if (rough) action = t`Não entre no trecho à frente. ${shelterLine(r.picks.vento)}`;
    if (r.sheltered) action = t`Fique abrigado até as rajadas baixarem.`;
    add('vento', level(r.windMps >= RULES.windDangerMps ? 'perigo' : 'atencao', ['habitat', 'vehicle', 'terrain']), t`Vento forte`,
      t`Rajadas de ${fmtNumber(r.windMps)} m/s, as mais fortes publicadas para Marte.`,
      t`No ar rarefeito, empurram como um vento de ${fmtNumber(earthEquivalentWindKmh(r.windMps))} km/h na Terra: não derrubam. O risco é a poeira levantada tirar a visão do chão.`, action);
  }

  if (r.radio.state === 'lost') {
    const over = r.radio.lostH >= RULES.radioSilenceLimitH;
    add('radio', r.sheltered === 'habitat' ? 'info' : over ? 'perigo' : 'atencao', t`Rádio sem resposta`,
      t`O rádio do traje não responde há ${minutes(r.radio.lostH)}.`, t`Ninguém acompanha sua telemetria nem orienta um resgate.`,
      over ? t`Limite de silêncio atingido: volte ao habitat. ${shelterLine(r.picks.radio)}`
        : t`Canal reserva e linha de visada. Com ${minutes(RULES.radioSilenceLimitH)} sem enlace, a regra é voltar.`);
  } else if (r.radio.state === 'shadow' && exposed) {
    // Trecho sem visada é previsto no plano: informa, não interrompe.
    add('sombra', 'info', t`Sem visada direta com o habitat`, t`O relevo está entre você e o mastro do habitat.`,
      r.comms.gapLeftM > 0 ? t`Sem rádio direto pelos próximos ${fmtDistance(r.comms.gapLeftM)} de rota.` : t`Sem rádio direto neste ponto.`,
      t`Trecho previsto no plano. Eu registro a telemetria e envio quando o enlace voltar.`);
  }

  if (r.m.vehicleDown) {
    let action = shelterLine(r.picks.veiculo);
    if (r.sheltered === 'vehicle') action = t`Fique na cabine, poupe O₂ e aguarde o resgate.`;
    add('veiculo', level(r.ret.ok ? 'perigo' : 'emergencia', ['habitat'], ['vehicle']), t`Pane do veículo`,
      t`O veículo perdeu a tração e não responde.`,
      r.ret.reaches ? t`A volta passa a ser a pé: ${walkBackText(r)}.` : t`A pé, o O₂ não alcança o habitat.`, action);
  }

  if (r.integrityPct < 100) {
    let action = r.patched
      ? t`Selante aplicado. Vá a um abrigo pressurizado. ${shelterLine(r.picks.traje)}`
      : t`Aplique o selante. Vá a um abrigo pressurizado. ${shelterLine(r.picks.traje)}`;
    if (r.sheltered) action = t`Faça a inspeção completa antes de sair.`;
    add('traje', level(r.leakPctH >= RULES.leakEmergencyPctH ? 'emergencia' : 'perigo', ['habitat', 'vehicle']), t`Traje danificado`,
      t`Integridade em ${pct(r.integrityPct)}. Vazamento de ${fmtNumber(r.leakPctH, 1)} %/h de O₂.`,
      t`Pressão em ${fmtNumber(r.pressureKpa, 1)} kPa. Neste ritmo, o oxigênio acaba em ${fmtDuration(r.o2AutonomyH)}.`, action);
  }

  const o2Low = r.o2Pct < RULES.o2ReservePct;
  if (o2Low && r.sheltered !== 'habitat') {
    add('o2', level('emergencia', [], ['vehicle']), t`O₂ abaixo da reserva`,
      t`O₂ em ${pct(r.o2Pct)}. A reserva é de ${RULES.o2ReservePct}%.`, t`Neste ritmo, o oxigênio acaba em ${fmtDuration(r.o2AutonomyH)}.`,
      r.sheltered ? t`Reabasteça no veículo antes de sair.` : t`Vá à fonte de O₂ mais próxima. ${shelterLine(r.picks.o2)}`);
  }

  // As regras abaixo olham o plano à frente: só valem enquanto ele está sendo seguido.
  if (exposed && r.nav.kind === 'plan') {
    if (!o2Low && r.o2EndPct < 0) {
      let action = shelterLine(r.nearestShelter);
      if (r.ret.reaches) action = t`Volte agora: ${walkBackText(r)}.`;
      if (r.pnr.status === 'ahead') action = t`Dê meia-volta antes do ponto de não retorno, a ${fmtDistance(r.pnr.aheadM)}.`;
      add('o2-plano', 'perigo', t`O₂ não cobre o plano`, t`Neste ritmo, o oxigênio acaba antes do fim da rota.`,
        t`Faltaria ${fmtDuration(-r.o2EndPct / SIM.o2PctPerHour.foot)} de autonomia.`, action);
    } else if (!o2Low && r.o2EndPct < RULES.o2ReservePct) {
      add('o2-plano', 'atencao', t`Plano termina dentro da reserva`, t`O₂ previsto na chegada: ${pct(r.o2EndPct)}.`,
        t`A reserva de ${RULES.o2ReservePct}% seria usada.`, t`Encurte uma parada ou antecipe o retorno.`);
    }

    if (r.pnr.status === 'ahead' && r.pnr.aheadM <= RULES.pnrWarnM) {
      add('pnr', 'atencao', t`Ponto de não retorno próximo`, t`Faltam ${fmtDistance(r.pnr.aheadM)}, cerca de ${fmtDuration(r.pnr.etaH)}.`,
        carOk ? t`Depois dele, se o veículo quebrar, o O₂ não cobre a volta a pé.` : t`Depois dele, o O₂ não cobre a volta a pé ao habitat.`,
        carOk ? t`Confira o veículo antes de cruzar.` : t`Decida agora: dar meia-volta ou encurtar a rota.`);
    } else if (r.pnr.status === 'passed') {
      add('pnr', carOk ? 'atencao' : 'perigo', t`Além do ponto de não retorno`, t`Daqui, o O₂ não cobre uma volta a pé ao habitat sem usar a reserva.`,
        carOk ? t`Você depende do veículo para voltar.` : t`Voltar a pé consome a reserva de O₂.`,
        carOk ? t`Fique perto do veículo e vigie o estado dele.` : t`Volte já pelo caminho mais rápido: ${walkBackText(r)}.`);
    }

    if (r.moving && r.slopeAheadDeg >= RULES.slopeCautionDeg) {
      add('declive', r.slopeAheadDeg >= RULES.slopeDangerDeg ? 'perigo' : 'atencao', t`Declive forte à frente`,
        t`Até ${fmtNumber(r.slopeAheadDeg)}° nos próximos ${SIM.slopeLookaheadM} m.`,
        r.m.driving ? t`Risco de o veículo derrapar.` : t`Risco de queda com o peso do traje.`,
        r.m.driving ? t`Reduza a velocidade e não pare no meio da rampa.` : t`Passo curto, apoio firme, sem parar no meio da rampa.`);
    }
  }

  if (exposed && r.hazard.near) {
    add('rochas', 'atencao', t`Rochas cortantes por perto`, t`Zona de rochas cortantes a ${fmtDistance(Math.max(0, r.hazard.edgeM))} ${r.hazard.side}.`,
      t`Podem cortar luvas e botas do traje.`, t`Fique na rota marcada.`);
  }

  if (r.sheltered !== 'habitat' && r.batteryPct < RULES.batteryCautionPct) {
    const critical = r.batteryPct < RULES.batteryDangerPct;
    add('bateria', critical ? 'perigo' : 'atencao', critical ? t`Bateria crítica` : t`Bateria baixa`, t`Bateria em ${pct(r.batteryPct)}.`,
      t`Neste ritmo, acaba em ${fmtDuration(r.batteryPct / r.batteryRatePctH)}. Sem ela não há aquecimento, rádio nem visor.`,
      t`Desligue o que não for vital e antecipe o retorno.`);
  }

  const doseFrac = r.doseUsv / RULES.doseLimitUsv;
  if (doseFrac >= RULES.doseCautionFrac && r.sheltered !== 'habitat') {
    const over = doseFrac >= 1;
    add('dose', over ? 'perigo' : 'atencao', over ? t`Limite de dose da saída atingido` : t`Dose perto do limite`,
      t`Dose acumulada: ${fmtNumber(r.doseUsv)} de ${fmtNumber(RULES.doseLimitUsv)} µSv.`,
      over ? t`Cada minuto fora soma dose além do planejado.` : t`Neste ritmo, o limite chega em ${fmtDuration(r.doseEtaH)}.`,
      over ? t`Encerre a saída e volte ao habitat.` : t`Reduza o tempo exposto e prepare o retorno.`);
  }

  if (r.dwell) {
    add('coleta', 'info', t`Coleta · parada ${r.dwell.stop.id}`, r.dwell.stop.task, t`Faltam ${minutes(r.dwell.remainingH)} de coleta.`,
      t`Eu vigio O₂, radiação e o caminho de volta.`);
  }
  if (r.finished) {
    add('fim', 'info', t`Saída encerrada no habitat`, t`Tempo de saída: ${fmtDuration(r.clockH)}.`,
      t`Dose: ${fmtNumber(r.doseUsv)} µSv. O₂ final: ${pct(r.o2Pct)}.`, t`Reabasteça e registre a saída.`);
  }
  // O frio também acontece sem cenário (antes do amanhecer o ar medido pelo REMS fica abaixo da faixa do traje).
  const isScenario = (alert) => SCENARIO_ALERTS.has(alert.id) || (alert.id === 'frio' && r.fx.tempOffsetC !== 0);
  return out.map((alert) => (isScenario(alert) ? { ...alert, cause: `${SCENARIO_NOTE} ${alert.cause}` } : alert));
}

// Frase de "seguro": responde se dá para voltar a pé daqui.
function safeLine(r) {
  if (r.mode === 'car') return t`Se o veículo quebrar aqui, você volta a pé: ${walkBackText(r)}.`;
  return t`Volta a pé garantida: ${walkBackText(r)}.`;
}

/** Linha de estado: a resposta curta para "estou seguro?". */
export function statusLine(r, alerts) {
  const top = alerts.find((alert) => levelOrder(alert.level) > 0);
  if (top) return { level: top.level, word: LEVELS[top.level].label, text: `${top.title} · ${top.action}` };
  if (r.finished) return { level: 'seguro', word: t`Seguro`, text: t`Saída encerrada no habitat.` };
  if (r.sheltered) return { level: 'seguro', word: t`Seguro`, text: t`Abrigado. Aguarde a liberação para retomar a saída.` };
  return { level: 'seguro', word: t`Seguro`, text: safeLine(r) };
}

// Avisos antes do problema: aparecem quando nada mais grave está na frente.
function preventive(r) {
  const carOk = r.m.vehicleM !== null && !r.m.vehicleDown;
  if (r.pnr.status === 'ahead' && r.pnr.aheadM <= RULES.pnrAdviseM) {
    return {
      key: 'aviso:pnr',
      text: carOk
        ? t`Ponto de não retorno em ${fmtDistance(r.pnr.aheadM)}. Antes de cruzar, confira bateria e tração do veículo.`
        : t`Ponto de não retorno em ${fmtDistance(r.pnr.aheadM)}. Para prevenir, decida a meia-volta antes dele.`,
    };
  }
  if (r.moving && r.slopeAheadDeg >= RULES.slopeAdviseDeg && r.slopeAheadDeg < RULES.slopeCautionDeg) {
    return { key: 'aviso:declive', text: t`Rampa de ${fmtNumber(r.slopeAheadDeg)}° logo à frente. Encurte o passo antes de entrar nela.` };
  }
  if (!r.hazard.near && r.hazard.edgeM < RULES.hazardAdviseM) {
    return { key: 'aviso:rochas', text: t`Rochas cortantes a ${fmtDistance(r.hazard.edgeM)} ${r.hazard.side}. Não corte caminho por lá.` };
  }
  const gap = r.comms.nextGap;
  if (r.radio.state === 'ok' && gap && gap.aheadM <= RULES.commsAdviseM) {
    return { key: 'aviso:radio', text: t`Em ${fmtDistance(gap.aheadM)} você perde a visada com o habitat por ${fmtDistance(gap.lengthM)} de rota. Avise a base antes de entrar.` };
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
    if (proto.current.type === 'decision') {
      const { abort, why } = proto.recommendation;
      const text = abort ? t`Recomendo abortar: ${why}. ${shelterLine(proto.pick)} A decisão é sua.` : t`Recomendo seguir: ${why}. A decisão é sua.`;
      return { key: `p:${proto.id}:decisao:${abort}`, priority: 3, text };
    }
    const head = t`${PROTOCOLS[proto.id].name}, passo ${proto.stepNumber} de ${proto.steps.length}.`;
    return { key: `p:${proto.id}:${proto.stepNumber}`, priority: 3, text: `${head} ${proto.current.text}` };
  }
  const top = alerts.find((alert) => !alert.ack && levelOrder(alert.level) > 0);
  if (top) return { key: `a:${top.id}:${top.level}`, priority: levelOrder(top.level), text: `${top.title}. ${top.action}` };
  if (r.finished) return { key: 'fim', priority: 0, text: t`Saída encerrada no habitat. Dose de ${fmtNumber(r.doseUsv)} µSv e O₂ em ${pct(r.o2Pct)}.` };
  if (r.sheltered) return { key: 'abrigado', priority: 0, text: t`Você está abrigado. Aviso quando for seguro retomar a saída.` };
  if (r.dwell) return { key: `coleta:${r.dwell.stop.id}`, priority: 0, text: t`Parada ${r.dwell.stop.id}. ${r.dwell.stop.task} Eu vigio O₂, radiação e o caminho de volta.` };
  const advice = preventive(r);
  if (advice) return { ...advice, priority: 1 };
  const next = r.target.kind === 'return' ? t`Habitat a ${fmtDistance(r.target.distM)}.` : t`${r.target.name} a ${fmtDistance(r.target.distM)}.`;
  return { key: `ok:${r.target.kind}:${r.target.stopId}`, priority: 0, text: t`Seguro. ${safeLine(r)} ${next}` };
}
