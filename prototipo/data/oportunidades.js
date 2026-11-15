// Onde a coleta do Curiosity falhou ou ficou incompleta na primeira tentativa, dentro da região da
// travessia. Em vários casos a missão resolveu depois, refazendo o furo ali perto: o texto de cada
// caso diz como terminou. Conferido em 14/11/2026 contra os relatos da missão.
//
// Os fatos vêm de docs/pesquisa.md (cada um com a página de origem). A posição de cada
// alvo é a do rover naquele sol, lida do trajeto real em travessia.js: é aproximada,
// porque o alvo fica a alguns metros do rover.
//
// A leitura "aqui um astronauta resolveria" é argumento da equipe, não afirmação da NASA.

import { TRACK } from './travessia.js';

export const OPPORTUNITIES = Object.freeze([
  {
    id: 'aberlady',
    name: 'Aberlady',
    sol: 2370,
    what: 'A rocha se moveu quando a broca foi retirada. A amostra foi analisada, mas não bastou para todos os experimentos; o segundo furo, Kilmarie, foi feito com sucesso a menos de 1 m dali.',
    source: { label: 'JPL, PIA23138', url: 'https://www.jpl.nasa.gov/images/pia23138-curiositys-first-clay-unit-drill-hole/' },
  },
  {
    id: 'amapari',
    name: 'Marker Band · Amapari',
    sol: 3676,
    what: 'A broca entrou só 7 mm: a rocha era dura demais. Foi a primeira de quatro tentativas sem amostra na parte ondulada dessa camada.',
    source: { label: 'Blog da missão, sols 3677–3679 (tentativa no sol 3676)', url: 'https://science.nasa.gov/blog/sols-3677-3679-lets-try-that-again-amapari/' },
  },
  {
    id: 'encanto',
    name: 'Marker Band · Encanto',
    sol: 3718,
    what: 'Terceira tentativa na camada: o furo não chegou à profundidade de amostragem.',
    source: { label: 'Blog da missão, sol 3721 (tentativa no sol 3718)', url: 'https://science.nasa.gov/blog/sol-3721-wrapping-up-at-the-encanto-drill-site/' },
  },
  {
    id: 'dinira',
    name: 'Marker Band · Dinira',
    sol: 3742,
    what: 'Só um mini-furo, raso demais. Foi a quarta tentativa na parte ondulada da camada; dez sols depois o rover conseguiu amostra em Tapo Caparo, na parte de cima da mesma camada.',
    source: { label: 'Blog da missão, sols 3744–3745', url: 'https://science.nasa.gov/blog/sols-3744-3745-the-one-that-got-away/' },
  },
  {
    id: 'mineral-king',
    name: 'Mineral King',
    sol: 4107,
    what: 'O furo do sol 4107 ficou raso: a amostra deu para o instrumento CheMin, mas não para o SAM. O segundo ponto foi reprovado no teste de estabilidade e o terceiro furo também ficou raso.',
    source: { label: 'Blog da missão, sols 4125–4126', url: 'https://science.nasa.gov/blog/sols-4125-4126-woohoo-were-go-for-drilling-at-mineral-king-3/' },
  },
  {
    id: 'mammoth-lakes',
    name: 'Mammoth Lakes',
    sol: 4214,
    what: 'O teste de estabilidade da rocha falhou e a perfuração saiu do plano. Cinco sols depois o rover furou com sucesso um ponto ao lado, na mesma rocha.',
    source: { label: 'Blog da missão, sols 4214–4215', url: 'https://science.nasa.gov/blog/sols-4214-4215-the-best-laid-plans/' },
  },
  {
    id: 'atacama',
    name: 'Atacama',
    sol: 4876,
    what: 'O bloco estava solto (cerca de 13 kg), saiu do chão preso à broca e o pó coletado se perdeu. A equipe refez o furo ali perto, em Campo Marte, e conseguiu amostra.',
    source: { label: 'Blog da missão, sols 4879–4885', url: 'https://science.nasa.gov/blog/curiosity-blog-sols-4879-4885-struggle-at-atacama/' },
  },
]);

// Posição do rover no sol dado: o último ponto do trajeto com sol menor ou igual.
export function trackPositionAtSol(sol) {
  let best = TRACK[0];
  for (const point of TRACK) {
    if (point[3] <= sol) best = point;
  }
  return { lat: best[0], lon: best[1], elev: best[2], sol: best[3] };
}
