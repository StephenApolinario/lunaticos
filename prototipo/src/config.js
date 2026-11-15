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

// Classes de declive da legenda do artifact original.
export const SLOPE_CLASSES = Object.freeze([
  { minDeg: 20, color: 'rgb(225,50,50)', label: 'Declive acima de 20°' },
  { minDeg: 15, color: 'rgb(240,130,40)', label: 'Declive 15–20°' },
  { minDeg: 10, color: 'rgb(245,200,60)', label: 'Declive 10–15°' },
]);

// Camadas em rampa de cor: faixa de valores, cores e a nota que explica de onde vem o dado.
// `simulated` marca o que não é medição nem cálculo sobre dado real (hoje, nenhuma camada).
export const LAYERS = Object.freeze({
  radiation: {
    label: 'Radiação',
    unit: 'µSv/h',
    min: 26.5,
    max: 27.9,
    minLabel: '26,5 µSv/h',
    maxLabel: '27,9 µSv/h',
    ramp: ['#1b1035', '#5c2a7e', '#b0457c', '#f08a5d', '#fbe7a1'],
    simulated: false,
    note: 'Radiação: média medida pelo RAD do Curiosity em Gale (0,67 mSv por dia, cerca de 27,9 µSv/h), reduzida onde o relevo tapa o céu. A proporção vem da medição do RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). O céu tapado é calculado sobre o relevo real. É estimativa, não medição ponto a ponto: o RAD só mede onde o rover está.',
  },
  thermal: {
    label: 'Térmico (noite)',
    unit: '',
    // Do percentil 2 ao 98 do brilho da imagem dentro da área de estudo.
    min: 110,
    max: 250,
    minLabel: 'mais frio à noite',
    maxLabel: 'mais quente à noite',
    ramp: ['#16204d', '#3d4f9f', '#8a6fb0', '#e08a5b', '#ffe9a8'],
    simulated: false,
    note: 'Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m por pixel servido pelo NASA Mars Trek. Mais quente à noite indica rocha exposta; mais frio indica areia e poeira soltas. É brilho relativo da imagem, não temperatura em graus. Se a cor não aparecer, a imagem não pôde ser lida da rede.',
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
  sand: {
    label: 'Areia fofa',
    unit: '',
    min: 0,
    max: 1,
    minLabel: 'chão firme (sem cor)',
    maxLabel: 'areia escura',
    ramp: ['#8b5cf6', '#e879f9'],
    simulated: false,
    note: 'Areia escura estimada pela equipe: onde a imagem HiRISE é escura e azulada e o chão é pouco inclinado. Não é mapa de areia da NASA. A rota prefere outro caminho, porque a areia fofa cansa quem anda e pode atolar o veículo.',
  },
});
