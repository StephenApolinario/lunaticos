// Constantes compartilhadas entre a cena, o painel do tablet e o visor.

export const COLORS = Object.freeze({
  route: '#16c2d5',
  vehicle: '#f5c04a',
  hazard: '#ef4a4f',
  rover: '#ffffff',
  accent: '#ec7a45',
  haze: '#c9a27e',
  zenith: '#7d6657',
  tabletBackground: '#0b0f13',
});

// Sol de meio da manhã, vindo de nordeste. Vetor (leste, cima, sul).
const SUN_RAW = [0.55, 0.72, -0.42];
const SUN_LENGTH = Math.hypot(...SUN_RAW);
export const SUN_DIRECTION = Object.freeze(SUN_RAW.map((component) => component / SUN_LENGTH));

// Classes de declive da legenda do artifact original.
export const SLOPE_CLASSES = Object.freeze([
  { minDeg: 20, color: 'rgb(225,50,50)', label: 'Declive acima de 20°' },
  { minDeg: 15, color: 'rgb(240,130,40)', label: 'Declive 15–20°' },
  { minDeg: 10, color: 'rgb(245,200,60)', label: 'Declive 10–15°' },
]);

// Camadas em rampa de cor: faixa de valores, cores e a nota que explica de onde vem o dado.
// `simulated` marca o que não é medição nem cálculo sobre dado real.
export const LAYERS = Object.freeze({
  radiation: {
    label: 'Radiação',
    unit: 'µSv/h',
    min: 23,
    max: 29,
    ramp: ['#1b1035', '#5c2a7e', '#b0457c', '#f08a5d', '#fbe7a1'],
    simulated: true,
    note: 'Radiação: dado simulado para validar a interface, não é medição de missão.',
  },
  temperature: {
    label: 'Temperatura do solo',
    unit: '°C',
    min: -34,
    max: -4,
    ramp: ['#2c5aa0', '#6fb1d6', '#e8e3c8', '#e89a5b', '#c7402f'],
    simulated: true,
    note: 'Temperatura do solo: dado simulado para validar a interface, não é medição de missão.',
  },
  walkback: {
    label: 'Volta a pé',
    unit: 'h',
    min: 0,
    max: 3,
    ramp: ['#1f8a5b', '#b6c94a', '#f5c04a', '#ef4a4f', '#5a1020'],
    simulated: false,
    note: 'Tempo de caminhada até o habitat, calculado sobre o relevo real. A velocidade a pé é hipótese da equipe. Sem cor: longe de qualquer caminho a pé dentro do limite de declive.',
  },
  comms: {
    label: 'Rádio',
    unit: '',
    min: 0,
    max: 1,
    minLabel: 'sem sinal direto',
    maxLabel: 'com sinal direto',
    ramp: ['#ef4a4f', '#16c2d5'],
    simulated: false,
    note: 'Linha de visada com o mastro do habitat, calculada sobre o relevo real. Alturas de antena (10 m no habitat, 2 m no traje) são hipótese da equipe.',
  },
});
