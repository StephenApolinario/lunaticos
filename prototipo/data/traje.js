// Traje e deslocamento: valores publicados pela NASA e o que o protótipo calcula a partir deles.
//
// Não existe traje real aqui, então nada do traje é medição. Mas os números também não são
// inventados: o consumo de oxigênio sai de uma conta com valores publicados (abaixo), e o que
// continua sendo escolha da equipe está marcado como hipótese.

const KG_PER_LB = 0.45359237;
const KPA_PER_PSI = 6.894757;
// Energia liberada por litro de oxigênio consumido: a regra de 5 kcal por litro.
const KJ_PER_LITRE_O2 = 20.9;
// Massa de um litro de oxigênio a 0 °C e 1 atm.
const GRAMS_PER_LITRE_O2 = 1.429;

export const SUIT = Object.freeze({
  // Oxigênio primário utilizável do sistema de suporte de vida do traje avançado da NASA
  // (precursor do xEMU): cerca de 1,8 lb, carregado a 3000 psia.
  primaryO2Kg: 1.8 * KG_PER_LB,
  // Taxa metabólica medida nas saídas lunares da Apollo, em kJ por hora. A pé: a mais alta entre
  // as médias por tripulante e saída (1200 BTU/h). No veículo: a de operar o jipe lunar (392 BTU/h).
  // Em Marte o peso é maior que na Lua, por isso vale a mais alta, e não a média.
  metabolicKjPerHour: Object.freeze({ foot: 1267, cabin: 414 }),
  // Pressão de operação do traje EMU da estação espacial: 4,3 psi.
  pressureKpa: 4.3 * KPA_PER_PSI,
  // Contingência de consumíveis: 1 hora além da saída planejada.
  contingencyH: 1,
  // Temperatura mínima do ar em que o traje trabalha: hipótese da equipe.
  minTempC: -60,
  // Consumo da bateria, em % por hora: hipótese da equipe (não achamos a capacidade publicada).
  batteryPctPerHour: Object.freeze({ foot: 9, cabin: 5 }),
  sources: Object.freeze({
    oxygen: Object.freeze({ label: 'Campbell 2012, NASA · sistema de suporte de vida do traje avançado', url: 'https://ntrs.nasa.gov/api/citations/20120009158/downloads/20120009158.pdf' }),
    metabolic: Object.freeze({ label: 'Paul, NASA · gasto de energia nas saídas até a Apollo', url: 'https://ntrs.nasa.gov/api/citations/20120003917/downloads/20120003917.pdf' }),
    pressure: Object.freeze({ label: 'NASA · traje EMU da estação espacial', url: 'https://ntrs.nasa.gov/api/citations/20140009556/downloads/20140009556.pdf' }),
    contingency: Object.freeze({ label: 'NASA EVA-EXP-0042 · conceito de operações de saída', url: 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf' }),
  }),
});

/** Oxigênio consumido por hora (kg) para uma taxa metabólica em kJ por hora. */
export const o2KgPerHour = (metabolicKjPerHour) => ((metabolicKjPerHour / KJ_PER_LITRE_O2) * GRAMS_PER_LITRE_O2) / 1000;

const pctPerHour = (metabolicKjPerHour) => (o2KgPerHour(metabolicKjPerHour) / SUIT.primaryO2Kg) * 100;

/** Consumo de oxigênio em % do tanque por hora: cerca de 10,6 a pé e 3,5 no veículo. */
export const O2_PCT_PER_HOUR = Object.freeze({ foot: pctPerHour(SUIT.metabolicKjPerHour.foot), cabin: pctPerHour(SUIT.metabolicKjPerHour.cabin) });

/** Reserva de oxigênio que o plano não pode tocar: a contingência de 1 hora, andando a pé. */
export const O2_RESERVE_PCT = Math.round(O2_PCT_PER_HOUR.foot * SUIT.contingencyH * 10) / 10;

// Velocidade a pé: valor de planejamento da NASA para a volta a pé de traje (cerca de 10 km em 5 h).
export const WALK_SPEED_KMH = 2;
export const WALK_SPEED_SOURCE = SUIT.sources.contingency;

export const SUIT_ORIGIN = 'calculado, não medido: não existe traje real neste protótipo. O consumo de oxigênio sai da taxa metabólica medida nas saídas lunares da Apollo e do tanque de oxigênio do traje avançado da NASA; a reserva é a contingência de 1 hora do conceito de operações da NASA; a pressão é a do traje EMU; o consumo da bateria é hipótese da equipe.';
export const SPEED_ORIGIN = 'A velocidade a pé (2 km/h) é o valor de planejamento da NASA para a volta a pé de traje; a do veículo (4,5 km/h) e os 45 min por parada são hipótese da equipe.';
