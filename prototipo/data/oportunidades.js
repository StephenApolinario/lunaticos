// Onde o Curiosity tentou coletar e não conseguiu, dentro da região da travessia.
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
    what: 'A rocha se moveu quando a broca foi retirada e a amostra não bastou para todos os experimentos; foi preciso um segundo furo.',
    source: { label: 'JPL, PIA23138', url: 'https://www.jpl.nasa.gov/images/pia23138-curiositys-first-clay-unit-drill-hole/' },
  },
  {
    id: 'amapari',
    name: 'Marker Band · Amapari',
    sol: 3677,
    what: 'A broca entrou só 7 mm: a rocha era dura demais. Foi a primeira de quatro tentativas sem amostra nessa camada.',
    source: { label: 'Blog da missão, sols 3677–3679', url: 'https://science.nasa.gov/blog/sols-3677-3679-lets-try-that-again-amapari/' },
  },
  {
    id: 'encanto',
    name: 'Marker Band · Encanto',
    sol: 3721,
    what: 'O furo não chegou à profundidade de amostragem.',
    source: { label: 'Blog da missão, sol 3721', url: 'https://science.nasa.gov/blog/sol-3721-wrapping-up-at-the-encanto-drill-site/' },
  },
  {
    id: 'dinira',
    name: 'Marker Band · Dinira',
    sol: 3742,
    what: 'Só um mini-furo; a equipe desistiu da camada e seguiu viagem.',
    source: { label: 'Blog da missão, sols 3744–3745', url: 'https://science.nasa.gov/blog/sols-3744-3745-the-one-that-got-away/' },
  },
  {
    id: 'mineral-king',
    name: 'Mineral King',
    sol: 4107,
    what: 'O furo ficou raso: a amostra deu para um instrumento e não para o outro. Duas tentativas seguintes também não renderam.',
    source: { label: 'Blog da missão, sols 4125–4126', url: 'https://science.nasa.gov/missions/mars-science-laboratory/sols-4125-4126-woohoo-were-go-for-drilling-at-mineral-king-3/' },
  },
  {
    id: 'mammoth-lakes',
    name: 'Mammoth Lakes',
    sol: 4214,
    what: 'O teste que verifica se a rocha é estável o bastante falhou, e a perfuração saiu do plano.',
    source: { label: 'Blog da missão, sols 4214–4215', url: 'https://science.nasa.gov/blog/sols-4214-4215-the-best-laid-plans/' },
  },
  {
    id: 'atacama',
    name: 'Atacama',
    sol: 4879,
    what: 'O bloco estava solto (cerca de 13 kg), saiu do chão preso à broca e o pó coletado se perdeu.',
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
