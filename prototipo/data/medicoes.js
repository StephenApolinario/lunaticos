// Medições de missões da NASA usadas pelo protótipo, cada uma com a fonte.
// Regra: nenhum número daqui é inventado. Se a fonte mudar, muda aqui e em docs/fontes.md.

import { t } from '../src/i18n.js';

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
    butte: Object.freeze({ label: t('Ehresmann et al. 2021, JGR Planets · RAD em Murray Buttes'), url: 'https://doi.org/10.1029/2021JE006851' }),
    solarEvent: Object.freeze({ label: t('JPL, 2017 · evento solar de 11/09/2017'), url: 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/' }),
  }),
});

// REMS (Rover Environmental Monitoring Station), a bordo do Curiosity: extremos de um sol típico
// no início da missão.
export const REMS = Object.freeze({
  air: Object.freeze({ minC: -75, maxC: -2 }),
  ground: Object.freeze({ minC: -91, maxC: 3 }),
  // O ar mais frio medido em dois anos marcianos: noite de inverno.
  recordAirMinC: -100,
  recordSource: Object.freeze({ label: t('JPL, 2016 · REMS/Curiosity, dois anos marcianos'), url: 'https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/' }),
  // Pressão de reserva para quando o feed não carrega: meio da faixa medida (679 a 925 Pa).
  fallbackPressurePa: 800,
  source: Object.freeze({ label: t('JPL, 21/08/2012 · REMS/Curiosity'), url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/' }),
});

// Vento e poeira: o que há publicado. O sensor de vento do REMS parou no sol 1491, então não existe
// medição de vento para o dia de hoje.
export const WIND = Object.freeze({
  // Os ventos das tempestades mais fortes de Marte chegam a cerca de 60 milhas por hora (27 m/s).
  strongestMps: 27,
  source: Object.freeze({ label: t('NASA · fato e ficção sobre as tempestades de poeira de Marte'), url: 'https://www.nasa.gov/content/the-fact-and-fiction-of-martian-dust-storms' }),
});
export const DUST = Object.freeze({
  // No pico da tempestade global de 2018, a visibilidade em Gale caiu para menos de 3 km.
  stormVisibilityM: 3000,
  source: Object.freeze({ label: t('Smith, Moores et al. 2019, GRL · visibilidade na tempestade de 2018'), url: 'https://arxiv.org/pdf/1910.00986' }),
});

// Posição mais recente do rover Curiosity publicada pela NASA, para quando não há rede.
// Lida em 15/11/2026 do mapa "Where is Curiosity?" (mesmo arquivo que src/nasa.js lê ao vivo).
export const CURIOSITY = Object.freeze({
  lat: -4.82602331, lon: 137.388886, elevM: -3472, sol: 5073, totalKm: 38.64, readOn: t('15/11/2026'), live: false,
  source: Object.freeze({ label: t('NASA/JPL · Where is Curiosity? (posição atual do rover)'), url: 'https://science.nasa.gov/mission/msl-curiosity/location-map/' }),
});

