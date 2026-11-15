// Protocolos de emergência: o que fazer em cada cenário de perigo.
//
// Os passos são PROPOSTAS DA EQUIPE para o protótipo, não procedimentos oficiais da NASA
// (`source`). `evidence` traz fatos de missão que sustentam o protocolo, cada um com a
// página de origem; a pesquisa completa está em docs/pesquisa.md.

import { t } from '../src/i18n.js';

const TEAM = t('Proposta da equipe');

export const SHELTER_KINDS = Object.freeze({
  habitat: t('Habitat'),
  vehicle: t('Veículo'),
  terrain: t('Proteção do relevo'),
  none: t('Sem abrigo: resolver no local'),
});

export const PROTOCOLS = Object.freeze([
  {
    id: 'tempestade',
    title: t('Tempestade de poeira chegando'),
    trigger: t('Opacidade do ar subindo ou aviso da base.'),
    shelter: 'habitat',
    steps: [
      t('Interromper a coleta e guardar as amostras já feitas.'),
      t('Voltar ao habitat pela rota de retorno enquanto houver visibilidade.'),
      t('Seguir a rota marcada no visor, sem cortar caminho.'),
      t('Se a visibilidade cair antes de chegar, parar no veículo ou em ponto conhecido e avisar a base.'),
    ],
    evidence: [
      { text: t('Na tempestade global de 2018, a opacidade do ar em Gale foi de cerca de 0,7 a 8,5 em dez sols, e a radiação ultravioleta máxima do dia caiu 90%.'), label: 'Viúdez-Moreiras et al. 2019', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/' },
    ],
    source: TEAM,
  },
  {
    id: 'evento-solar',
    title: t('Evento solar (radiação)'),
    trigger: t('Taxa de dose muito acima do normal ou alerta de clima espacial.'),
    shelter: 'terrain',
    steps: [
      t('Parar a atividade e avisar a base.'),
      t('Ir para o abrigo mais rápido de alcançar: habitat, se estiver perto; senão, a proteção de relevo indicada.'),
      t('Ficar junto à encosta, com o máximo de céu tapado.'),
      t('Só retomar depois que a taxa de dose voltar ao normal.'),
    ],
    evidence: [
      { text: t('No evento solar de 20/05/2024, o maior medido pelo instrumento RAD, um astronauta ao lado do rover teria recebido 8.100 microgray; paredões dariam blindagem extra.'), label: t('JPL, 10/06/2024'), url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/' },
      { text: t('Encostado num paredão em Murray Buttes, o RAD mediu queda de só 4% na radiação total: o relevo ajuda em evento solar, não como proteção contínua.'), label: 'JPL', url: 'https://www.jpl.nasa.gov/news/how-nasas-curiosity-rover-is-making-mars-safer-for-astronauts/' },
    ],
    source: TEAM,
  },
  {
    id: 'temperatura',
    title: t('Temperatura fora da faixa do traje'),
    trigger: t('Traje sem conseguir manter a temperatura interna.'),
    shelter: 'vehicle',
    steps: [
      t('Reduzir o esforço e sair de encostas na sombra ou no sol direto.'),
      t('Conferir bateria: aquecimento e refrigeração dependem dela.'),
      t('Ir para o veículo ou para o habitat, o que estiver mais perto.'),
    ],
    evidence: [
      { text: t('Em um sol típico do início da missão, o ar em Gale foi de -2 °C a -75 °C e o solo de 3 °C a -91 °C.'), label: t('JPL, 21/08/2012'), url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/' },
    ],
    source: TEAM,
  },
  {
    id: 'vento',
    title: t('Vento forte'),
    trigger: t('Rajadas levantando poeira ou derrubando equipamento.'),
    shelter: 'terrain',
    steps: [
      t('Prender equipamento solto e amostras.'),
      t('Sair de cristas e bordas expostas.'),
      t('Esperar em terreno baixo e protegido, mantendo contato com a base.'),
    ],
    evidence: [
      { text: t('A análise das flutuações de pressão do REMS estima ventos de encosta à noite de até cerca de 21 m/s e máximo de dia de cerca de 14 m/s. É estimativa, não medida direta do sensor de vento.'), label: t('Ullán et al. 2017 (resumo)'), url: 'https://cab.inta-csic.es/en/publicaciones/analysis-of-wind-induced-dynamic-pressure-fluctuations-during-one-and-a-half-martian-years-at-gale-crater/' },
      { text: t('O sensor de vento do REMS foi danificado no pouso, funcionou só em parte até o sol 1491 e então parou.'), label: 'Viúdez-Moreiras et al. 2019', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/' },
    ],
    source: TEAM,
  },
  {
    id: 'radio',
    title: t('Perda de comunicação por rádio'),
    trigger: t('Sem linha de visada com o habitat ou falha do rádio.'),
    shelter: 'none',
    steps: [
      t('Não avançar: voltar ao último ponto da rota que tinha sinal.'),
      t('Tentar de novo de um ponto mais alto, se for seguro subir.'),
      t('Sem contato dentro do prazo combinado antes da saída, iniciar o retorno ao habitat.'),
    ],
    evidence: [
      { text: t('Nas Apollo, o rádio entre o astronauta e o repetidor do jipe lunar alcançava pelo menos 500 m, e o manual mandava avaliar antes do voo as saídas com obstáculos no caminho do sinal.'), label: t('Manual do LCRU, 1971'), url: 'https://apollojournals.org/alsj/HSI-481184-LCRU.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'pane-veiculo',
    title: t('Pane do veículo'),
    trigger: t('Veículo parado e sem conserto no local.'),
    shelter: 'habitat',
    steps: [
      t('Avisar a base e conferir o oxigênio do traje.'),
      t('Conferir no visor o tempo de volta a pé a partir deste ponto.'),
      t('Se o oxigênio cobre a volta com a reserva, voltar a pé pela rota mais curta.'),
      t('Se não cobre, ficar junto ao veículo, economizar e pedir resgate.'),
    ],
    evidence: [
      { text: t('O jipe lunar das Apollo tinha autonomia de 92 km, mas as tripulações nunca passaram de 7,6 km do módulo: era a maior distância que dava para voltar a pé se o veículo parasse.'), label: 'NASA OCHMO-TB-023', url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf' },
      { text: t('O conceito atual da NASA mantém a regra: veículo não pressurizado a menos de 5 horas de caminhada. Para Marte, o raio ainda não foi definido.'), label: 'NASA EVA-EXP-0042 Rev. B', url: 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'oxigenio',
    title: t('Oxigênio abaixo da reserva'),
    trigger: t('Margem de oxigênio negativa para terminar o plano.'),
    shelter: 'habitat',
    steps: [
      t('Cancelar as paradas que faltam.'),
      t('Voltar pelo caminho de menor tempo, não pelo planejado.'),
      t('Manter passo constante e avisar a base a cada trecho.'),
    ],
    evidence: [
      { text: t('O traje lunar atual da NASA é projetado para saídas de até 8 horas, com 1 hora de reserva. Para Marte a duração ainda não foi fixada.'), label: 'NASA EVA-EXP-0042 Rev. B', url: 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'atolamento',
    title: t('Atolamento ou roda danificada'),
    trigger: t('Veículo patinando em areia ou com roda furada.'),
    shelter: 'none',
    steps: [
      t('Parar de acelerar: insistir afunda mais.'),
      t('Descer e avaliar o terreno a pé antes de qualquer manobra.'),
      t('Sem saída segura, tratar como pane do veículo.'),
    ],
    evidence: [
      { text: t('O Opportunity atolou em 26/04/2005 numa ondulação de areia de cerca de 30 cm de altura; sair levou mais de cinco semanas.'), label: 'JPL, PIA07999', url: 'https://www.jpl.nasa.gov/images/pia07999-looking-back-at-purgatory-dune/' },
      { text: t('Ele seguia girando as rodas um número fixo de voltas sem checar a posição, e continuou cavando. Depois disso a equipe deixou de cruzar dunas desse jeito.'), label: t('NASA, podcast On a Mission'), url: 'https://www.nasa.gov/podcasts/on-a-mission/a-lifetime-on-mars-the-adventures-of-spirit-and-opportunity-s4e4/' },
      { text: t('A Spirit ficou presa em 2009 ao romper uma crosta que escondia areia solta: o perigo não aparecia na superfície.'), label: t('JPL, 12/11/2009'), url: 'https://www.jpl.nasa.gov/news/nasa-to-begin-attempts-to-free-sand-trapped-mars-rover/' },
      { text: t('Rochas afiadas pelo vento (ventifactos) danificaram as rodas do Curiosity no início da missão; em 2022 o rover deu meia-volta diante do terreno de rochas cortantes do pedimento Greenheugh.'), label: t('JPL, 07/04/2022'), url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/' },
    ],
    source: TEAM,
  },
]);

export function protocolFor(id) {
  const protocol = PROTOCOLS.find((entry) => entry.id === id);
  if (!protocol) throw new Error(`Protocolo desconhecido: ${id}`);
  return protocol;
}
