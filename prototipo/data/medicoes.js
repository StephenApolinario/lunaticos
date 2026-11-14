// Medições de missões da NASA usadas pelo protótipo, cada uma com a fonte.
// Regra: nenhum número daqui é inventado. Se a fonte mudar, muda aqui e em docs/fontes.md.

const HOURS_PER_DAY = 24;
const SURFACE_MSV_PER_DAY = 0.67;

// RAD (Radiation Assessment Detector), a bordo do Curiosity, na cratera Gale.
export const RAD = Object.freeze({
  // Dose equivalente média na superfície entre agosto de 2012 e junho de 2013, sem tempestade solar forte.
  surfaceMsvPerDay: SURFACE_MSV_PER_DAY,
  surfaceUsvPerHour: (SURFACE_MSV_PER_DAY * 1000) / HOURS_PER_DAY,
  // Murray Buttes, sols 1456 a 1467 (10 a 21/09/2016): com o rover ao lado de um morro que tapava
  // 19% do céu, a taxa de dose ficou 4% abaixo da esperada.
  butteShieldingFraction: 0.04,
  butteSkyBlocked: 0.19,
  // Evento de partículas solares de 11/09/2017: a superfície passou do dobro de qualquer medida anterior do RAD.
  // Aplicar esse fator sobre a média (e não sobre o máximo anterior) é simplificação da equipe.
  solarEventFactor: 2,
  sources: Object.freeze({
    surface: Object.freeze({ label: 'NASA, 2013 · RAD/Curiosity', url: 'https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/' }),
    butte: Object.freeze({ label: 'Ehresmann et al. 2021, JGR Planets · RAD em Murray Buttes', url: 'https://doi.org/10.1029/2021JE006851' }),
    solarEvent: Object.freeze({ label: 'JPL, 2017 · evento solar de 11/09/2017', url: 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/' }),
  }),
});

// REMS (Rover Environmental Monitoring Station), a bordo do Curiosity: extremos de um sol típico
// no início da missão.
export const REMS = Object.freeze({
  air: Object.freeze({ minC: -75, maxC: -2 }),
  ground: Object.freeze({ minC: -91, maxC: 3 }),
  source: Object.freeze({ label: 'JPL, 21/08/2012 · REMS/Curiosity', url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/' }),
});
