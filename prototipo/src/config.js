// Constantes compartilhadas entre a cena, o painel do tablet e o visor.

import { t } from './i18n.js';

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

// Brilho do que fica fora da área mapeada no mapa local (o chão em volta e a faixa de relevo sem
// foto). No planeta a sombra é mais forte, de 75% (globo.js); aqui é mais leve, para as bordas da
// tela não ficarem pretas.
export const OUTSIDE_AREA_BRIGHTNESS = 0.55;

// Classes de declive da legenda do artifact original.
export const SLOPE_CLASSES = Object.freeze([
  { minDeg: 20, color: 'rgb(225,50,50)', label: t('Declive acima de 20°') },
  { minDeg: 15, color: 'rgb(240,130,40)', label: t('Declive 15–20°') },
  { minDeg: 10, color: 'rgb(245,200,60)', label: t('Declive 10–15°') },
]);

// Camadas em rampa de cor: faixa de valores, cores e a nota que explica de onde vem o dado.
// `simulated` marca o que não é medição nem cálculo sobre dado real (hoje, nenhuma camada).
export const LAYERS = Object.freeze({
  radiation: {
    label: t('Radiação'),
    unit: 'µSv/h',
    min: 26.5,
    max: 27.9,
    minLabel: t('26,5 µSv/h'),
    maxLabel: t('27,9 µSv/h'),
    ramp: ['#1b1035', '#5c2a7e', '#b0457c', '#f08a5d', '#fbe7a1'],
    simulated: false,
    note: t('Radiação: média medida pelo RAD do Curiosity em Gale (0,67 mSv por dia, cerca de 27,9 µSv/h), reduzida onde o relevo tapa o céu. A proporção vem da medição do RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). O céu tapado é calculado sobre o relevo real. É estimativa, não medição ponto a ponto: o RAD só mede onde o rover está.'),
  },
  thermal: {
    label: t('Térmico (noite)'),
    unit: '',
    // Do percentil 2 ao 98 do brilho da imagem dentro da área de estudo.
    min: 110,
    max: 250,
    minLabel: t('mais frio à noite'),
    maxLabel: t('mais quente à noite'),
    ramp: ['#16204d', '#3d4f9f', '#8a6fb0', '#e08a5b', '#ffe9a8'],
    simulated: false,
    note: t('Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m por pixel servido pelo NASA Mars Trek. Mais quente à noite indica rocha exposta; mais frio indica areia e poeira soltas. É brilho relativo da imagem, não temperatura em graus. Se a cor não aparecer, a imagem não pôde ser lida da rede.'),
  },
  walkback: {
    label: t('Volta a pé'),
    unit: 'h',
    min: 0,
    max: 3,
    ramp: ['#1f8a5b', '#b6c94a', '#f5c04a', '#ef4a4f', '#5a1020'],
    simulated: false,
    note: t('Tempo de caminhada até o habitat, calculado sobre o relevo real. A velocidade a pé é hipótese da equipe. Sem cor: longe de qualquer caminho a pé dentro do limite de declive.'),
  },
  comms: {
    label: t('Rádio'),
    unit: '',
    min: 0,
    max: 1,
    minLabel: t('sem sinal direto'),
    maxLabel: t('com sinal direto'),
    ramp: ['#ef4a4f', '#16c2d5'],
    simulated: false,
    note: t('Linha de visada com o mastro do habitat, calculada sobre o relevo real. Alturas de antena (10 m no habitat, 2 m no traje) são hipótese da equipe.'),
  },
  sand: {
    label: t('Areia fofa'),
    unit: '',
    min: 0,
    max: 1,
    minLabel: t('chão firme (sem cor)'),
    maxLabel: t('areia escura'),
    ramp: ['#8b5cf6', '#e879f9'],
    simulated: false,
    note: t('Areia escura estimada pela equipe: onde a imagem HiRISE é escura e azulada e o chão é pouco inclinado. Não é mapa de areia da NASA. A rota prefere outro caminho, porque a areia fofa cansa quem anda e pode atolar o veículo.'),
  },
});

// Qualidade de renderização. A mínima é o padrão: é a da primeira versão do protótipo e roda em
// qualquer computador. A alta lê da rede a imagem mais fina e pesa em placas de vídeo modestas.
// `pixelRatio`: teto de pixels do aparelho por pixel da página. `shadowMapPx`: 0 desliga a sombra
// projetada (as encostas ainda escurecem pela inclinação). `finePhoto`: usa a foto pronta de 0,69 m
// (assets/hirise-fina/), carregada uma vez. `liveDetail`: níveis de imagem lidos da rede enquanto a
// câmera anda (ver detalhe.js); é o que mais pesa.
export const QUALITY = Object.freeze({
  minima: Object.freeze({ label: t('Mínima', 'qualidade'), pixelRatio: 1, shadowMapPx: 0, softShadows: false, finePhoto: false, liveDetail: Object.freeze([]), grain: false, note: t('Foto de 2,5 m por pixel, sem sombra projetada. Leve em qualquer computador.') }),
  media: Object.freeze({ label: t('Média', 'qualidade'), pixelRatio: 1.5, shadowMapPx: 2048, softShadows: false, finePhoto: true, liveDetail: Object.freeze([]), grain: true, note: t('Foto de 0,7 m por pixel já pronta (nítida de longe, sem buscar na rede) e sombras do relevo.') }),
  alta: Object.freeze({ label: t('Alta', 'qualidade'), pixelRatio: 2, shadowMapPx: 4096, softShadows: true, finePhoto: true, liveDetail: Object.freeze(['25 cm']), grain: true, note: t('Foto de 0,7 m, sombras suaves e, de perto, a imagem de 25 cm lida da rede. Pesa em computadores modestos.') }),
});
export const DEFAULT_QUALITY = 'minima';
