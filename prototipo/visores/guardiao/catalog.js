// Catálogo do Guardião: níveis de alerta, limites de segurança, panes injetadas
// pelos cenários de demonstração e os protocolos de emergência.
// Limites, panes e protocolos são REGRAS DE PROTÓTIPO (simuladas), não norma da NASA.

import { SUIT } from '../../data/traje.js';
import { WIND, DUST } from '../../data/medicoes.js';
import { SIM } from '../../src/simulation.js';
import { ASSUMPTIONS } from '../../src/safety.js';
import { fmtDuration, fmtNumber } from '../../src/format.js';
import { t } from '../../src/i18n.js';

export const LEVELS = Object.freeze({
  info: Object.freeze({ order: 0, label: t`Informação`, glyph: 'i' }),
  atencao: Object.freeze({ order: 1, label: t`Atenção`, glyph: '!' }),
  perigo: Object.freeze({ order: 2, label: t`Perigo`, glyph: '!!' }),
  emergencia: Object.freeze({ order: 3, label: t`Emergência`, glyph: '✕' }),
});
export const levelOrder = (level) => LEVELS[level].order;

export const RULES = Object.freeze({
  o2ReservePct: ASSUMPTIONS.o2ReservePct, // reserva que o plano não pode tocar: a mesma hipótese do tablet
  o2TightPct: 10, // folga acima da reserva considerada justa
  batteryCautionPct: 30,
  batteryDangerPct: 15,
  doseLimitUsv: 1000, // limite de dose de uma saída
  doseCautionFrac: 0.6,
  suitMinTempC: SUIT.minTempC, // hipótese da equipe (data/traje.js)
  coldAdviseH: 1, // avisa do frio com esta antecedência (hipótese da equipe)
  windCautionMps: 15,
  windDangerMps: 25,
  slopeCautionDeg: SIM.slopeWarnDeg,
  slopeDangerDeg: 20, // mesma classe vermelha do mapa de declive
  slopeAdviseDeg: 10,
  radioSilenceLimitH: 10 / 60,
  pnrWarnM: 500,
  pnrAdviseM: 1500,
  hazardAdviseM: 400,
  commsAdviseM: 400,
  pressureNominalKpa: SUIT.pressureKpa, // 4,3 psi, pressão de operação do traje EMU da NASA (data/traje.js)
  leakEmergencyPctH: 10,
  solarShelterBudgetH: 1,
  windShelterBudgetH: 0.5,
});

// O que cada cenário injeta no mundo simulado.
export const FAULTS = Object.freeze({
  solarFactor: SIM.solarEventFactor,
  dustEtaH: 40 / 60,
  dustVisibilityM: DUST.stormVisibilityM, // medido no pico da tempestade global de 2018 (data/medicoes.js)
  coldOffsetC: -1, // só marca o cenário de frio: o ar vai ao mínimo já medido pelo REMS (readout.js)
  coldBatteryExtraPctH: 8,
  windNominalMps: null, // sem medição: o sensor de vento do REMS parou no sol 1491
  windStormMps: WIND.strongestMps, // os ventos mais fortes publicados para Marte (data/medicoes.js)
  fallIntegrityPct: 78,
  patchIntegrityPct: 93,
  leakPctHPerPoint: 0.9, // O₂ perdido por hora a cada ponto de integridade a menos
  pressureDropPerPoint: 0.005,
  o2FaultPct: ASSUMPTIONS.o2ReservePct - 3, // nível em que o O₂ fica depois da falha de tanque
  // Fração da radiação extra de um evento solar que ainda chega em cada abrigo.
  exposure: Object.freeze({ habitat: 0.1, vehicle: 0.5 }),
});

export const SHELTER_NAMES = Object.freeze({ habitat: 'Habitat', vehicle: t`Veículo`, terrain: t`Relevo` });
export const SHELTER_PHRASES = Object.freeze({ habitat: t`o habitat`, vehicle: t`o veículo`, terrain: t`o abrigo no relevo` });

// Botões do painel de demonstração, na ordem das teclas 1 a 8.
export const SCENARIOS = Object.freeze([
  { id: 'poeira', label: t`Tempestade de poeira` },
  { id: 'solar', label: t`Evento solar` },
  { id: 'frio', label: t`Frio extremo` },
  { id: 'vento', label: t`Vento forte` },
  { id: 'radio', label: t`Perda de rádio` },
  { id: 'veiculo', label: t`Pane do veículo`, needsVehicle: true },
  { id: 'o2', label: t`O₂ na reserva` },
  { id: 'traje', label: t`Queda · traje danificado` },
]);

const minutes = (hours) => `${Math.max(1, Math.round(hours * 60))} min`;

// Cada protocolo: passos antes da decisão, a política de abrigo, a recomendação
// (seguir ou abortar, calculada da leitura `r`) e o passo final já abrigado.
// `kinds` vem em ordem de proteção; `nearest` escolhe só pelo tempo.
// `shared` aponta o protocolo da equipe em data/protocolos.js de onde vêm o título e a
// evidência; aqui os passos são reescritos na forma confirmar, decidir, ir, encerrar.
export const PROTOCOLS = Object.freeze({
  solar: {
    name: t`Evento solar`,
    shared: 'evento-solar',
    shelter: { kinds: ['habitat', 'vehicle', 'terrain'], budgetH: () => RULES.solarShelterBudgetH },
    before: [t`Pare a coleta e guarde as amostras.`, t`Confira o alarme no dosímetro do traje.`],
    after: t`Fique abrigado até o fim do evento e informe a dose ao habitat.`,
    recommend: (r) => ({
      abort: true,
      why: r.doseEtaH > 0 ? t`sem abrigo, a dose chega ao limite em ${fmtDuration(r.doseEtaH)}` : t`a dose da saída já passou do limite`,
    }),
  },
  poeira: {
    name: t`Tempestade de poeira`,
    shared: 'tempestade',
    shelter: { kinds: ['habitat', 'vehicle', 'terrain'], budgetH: (fx) => fx.dust?.etaH ?? 0 },
    before: [t`Limpe o visor e acenda as luzes de posição.`, t`Guie-se pela linha da rota no visor, não pelo horizonte.`],
    after: t`Fique abrigado até a frente passar. Desligue o que não for vital.`,
    recommend: (r) => {
      const { etaH, arrived } = r.fx.dust;
      if (arrived) return { abort: true, why: t`a frente de poeira já chegou` };
      if (r.planRemainingH + 0.25 < etaH) return { abort: false, why: t`você fecha a rota ${minutes(etaH - r.planRemainingH)} antes da frente` };
      return { abort: true, why: t`a frente chega em ${minutes(etaH)} e a rota ainda leva ${fmtDuration(r.planRemainingH)}` };
    },
  },
  frio: {
    name: t`Frio extremo`,
    shared: 'temperatura',
    shelter: { kinds: ['vehicle', 'habitat'], nearest: true },
    before: [t`Confira o aquecimento de luvas e botas.`, t`Corte as paradas longas para poupar bateria.`],
    after: t`Fique abrigado até a temperatura voltar à faixa do traje.`,
    recommend: (r) => (r.batteryEndPct < RULES.batteryDangerPct
      ? { abort: true, why: t`a bateria fecharia a rota em ${fmtNumber(Math.max(0, r.batteryEndPct))}%` }
      : { abort: false, why: t`a bateria fecha a rota com ${fmtNumber(r.batteryEndPct)}%` }),
  },
  vento: {
    name: t`Vento forte`,
    shared: 'vento',
    shelter: { kinds: ['vehicle', 'habitat', 'terrain'], budgetH: () => RULES.windShelterBudgetH },
    before: [t`Prenda o equipamento solto.`, t`Afaste-se de encostas e de blocos soltos.`],
    after: t`Fique abrigado até as rajadas baixarem.`,
    recommend: (r) => (r.slopeAheadDeg >= RULES.slopeCautionDeg || r.hazard.near
      ? { abort: true, why: t`há declive forte ou rochas cortantes logo à frente` }
      : { abort: false, why: t`o terreno à frente é suave (até ${fmtNumber(r.slopeAheadDeg)}°). Vá com passo curto` }),
  },
  radio: {
    name: t`Perda de rádio`,
    shared: 'radio',
    shelter: { kinds: ['habitat'] },
    before: [t`Pare e chame o habitat no canal reserva.`, t`Procure linha de visada: suba um pouco ou volte ao último ponto com sinal.`],
    after: t`No habitat, registre onde o enlace caiu.`,
    recommend: (r) => (r.radio.lostH >= RULES.radioSilenceLimitH
      ? { abort: true, why: t`passou o limite de ${minutes(RULES.radioSilenceLimitH)} sem enlace` }
      : { abort: false, why: t`ainda há ${minutes(RULES.radioSilenceLimitH - r.radio.lostH)} para recuperar o enlace` }),
  },
  veiculo: {
    name: t`Pane do veículo`,
    shared: 'pane-veiculo',
    shelter: { kinds: ['habitat', 'vehicle'] },
    before: [t`Freie, desligue a tração e fique na cabine.`, t`Leia o painel de falhas e tente religar uma vez.`],
    after: t`Informe a posição do veículo para o resgate.`,
    recommend: (r) => ({
      abort: true,
      why: r.ret.reaches ? t`a pé o O₂ chega ao habitat com ${fmtNumber(r.ret.o2AfterPct)}%` : t`a pé o O₂ não alcança o habitat`,
    }),
  },
  o2: {
    name: t`O₂ abaixo da reserva`,
    shared: 'oxigenio',
    shelter: { kinds: ['vehicle', 'habitat'], nearest: true },
    before: [t`Pare o esforço e respire devagar.`, t`Abra o tanque reserva e confira a pressão.`],
    after: t`Reabasteça o O₂ antes de qualquer nova saída.`,
    afterEffect: 'reabastecer',
    recommend: (r) => ({ abort: true, why: t`o oxigênio acaba em ${fmtDuration(r.o2AutonomyH)}` }),
  },
  traje: {
    name: t`Queda · traje danificado`,
    shelter: { kinds: ['vehicle', 'habitat'], nearest: true },
    before: [t`Fique parado. Confira dor, visão e movimento.`, t`Ache o dano: veja pressão e integridade no painel.`, t`Aplique o selante de emergência sobre o dano.`],
    effects: Object.freeze({ 2: 'selante' }),
    after: t`Em local pressurizado, faça a inspeção completa do traje.`,
    recommend: (r) => ({ abort: true, why: t`o traje perde ${fmtNumber(r.leakPctH, 1)} %/h de O₂` }),
  },
});
