// Protocolos de emergência: o que fazer em cada cenário de perigo.
//
// Os passos são PROPOSTAS DA EQUIPE para o protótipo, não procedimentos oficiais da NASA
// (`source`). `evidence` traz fatos de missão que sustentam o protocolo, cada um com a
// página de origem; a pesquisa completa está em docs/pesquisa.md.

const TEAM = 'Proposta da equipe';

export const SHELTER_KINDS = Object.freeze({
  habitat: 'Habitat',
  vehicle: 'Veículo',
  terrain: 'Proteção do relevo',
  none: 'Sem abrigo: resolver no local',
});

export const PROTOCOLS = Object.freeze([
  {
    id: 'tempestade',
    title: 'Tempestade de poeira chegando',
    trigger: 'Opacidade do ar subindo ou aviso da base.',
    shelter: 'habitat',
    steps: [
      'Interromper a coleta e guardar as amostras já feitas.',
      'Voltar ao habitat pela rota de retorno enquanto houver visibilidade.',
      'Seguir a rota marcada no visor, sem cortar caminho.',
      'Se a visibilidade cair antes de chegar, parar no veículo ou em ponto conhecido e avisar a base.',
    ],
    evidence: [
      { text: 'Na tempestade global de 2018, a opacidade do ar em Gale foi de cerca de 0,7 a 8,5 em dez sols, e a radiação ultravioleta máxima do dia caiu 90%.', label: 'Viúdez-Moreiras et al. 2019', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/' },
    ],
    source: TEAM,
  },
  {
    id: 'evento-solar',
    title: 'Evento solar (radiação)',
    trigger: 'Taxa de dose muito acima do normal ou alerta de clima espacial.',
    shelter: 'terrain',
    steps: [
      'Parar a atividade e avisar a base.',
      'Ir para o abrigo mais rápido de alcançar: habitat, se estiver perto; senão, a proteção de relevo indicada.',
      'Ficar junto à encosta, com o máximo de céu tapado.',
      'Só retomar depois que a taxa de dose voltar ao normal.',
    ],
    evidence: [
      { text: 'No evento solar de 20/05/2024, o maior medido pelo instrumento RAD, um astronauta ao lado do rover teria recebido 8.100 microgray; paredões dariam blindagem extra.', label: 'JPL, 10/06/2024', url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/' },
      { text: 'Encostado num paredão em Murray Buttes, o RAD mediu queda de só 4% na radiação total: o relevo ajuda em evento solar, não como proteção contínua.', label: 'JPL', url: 'https://www.jpl.nasa.gov/news/how-nasas-curiosity-rover-is-making-mars-safer-for-astronauts/' },
    ],
    source: TEAM,
  },
  {
    id: 'temperatura',
    title: 'Temperatura fora da faixa do traje',
    trigger: 'Traje sem conseguir manter a temperatura interna.',
    shelter: 'vehicle',
    steps: [
      'Reduzir o esforço e sair de encostas na sombra ou no sol direto.',
      'Conferir bateria: aquecimento e refrigeração dependem dela.',
      'Ir para o veículo ou para o habitat, o que estiver mais perto.',
    ],
    evidence: [
      { text: 'Em um sol típico do início da missão, o ar em Gale foi de -2 °C a -75 °C e o solo de 3 °C a -91 °C.', label: 'JPL, 21/08/2012', url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/' },
    ],
    source: TEAM,
  },
  {
    id: 'vento',
    title: 'Vento forte',
    trigger: 'Rajadas levantando poeira ou derrubando equipamento.',
    shelter: 'terrain',
    steps: [
      'Prender equipamento solto e amostras.',
      'Sair de cristas e bordas expostas.',
      'Esperar em terreno baixo e protegido, mantendo contato com a base.',
    ],
    evidence: [
      { text: 'A análise dos dados do REMS indica ventos de encosta à noite de até cerca de 21 m/s e máximo de dia de cerca de 14 m/s. O sensor de vento parou no sol 1491.', label: 'Ullán et al. 2017 (resumo)', url: 'https://cab.inta-csic.es/en/publicaciones/analysis-of-wind-induced-dynamic-pressure-fluctuations-during-one-and-a-half-martian-years-at-gale-crater/' },
    ],
    source: TEAM,
  },
  {
    id: 'radio',
    title: 'Perda de comunicação por rádio',
    trigger: 'Sem linha de visada com o habitat ou falha do rádio.',
    shelter: 'none',
    steps: [
      'Não avançar: voltar ao último ponto da rota que tinha sinal.',
      'Tentar de novo de um ponto mais alto, se for seguro subir.',
      'Sem contato dentro do prazo combinado antes da saída, iniciar o retorno ao habitat.',
    ],
    evidence: [
      { text: 'Nas Apollo, o rádio entre o astronauta e o repetidor do jipe lunar alcançava pelo menos 500 m, e o manual mandava avaliar antes do voo as saídas com obstáculos no caminho do sinal.', label: 'Manual do LCRU, 1971', url: 'https://apollojournals.org/alsj/HSI-481184-LCRU.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'pane-veiculo',
    title: 'Pane do veículo',
    trigger: 'Veículo parado e sem conserto no local.',
    shelter: 'habitat',
    steps: [
      'Avisar a base e conferir o oxigênio do traje.',
      'Conferir no visor o tempo de volta a pé a partir deste ponto.',
      'Se o oxigênio cobre a volta com a reserva, voltar a pé pela rota mais curta.',
      'Se não cobre, ficar junto ao veículo, economizar e pedir resgate.',
    ],
    evidence: [
      { text: 'O jipe lunar das Apollo tinha autonomia de 92 km, mas as tripulações nunca passaram de 7,6 km do módulo: era a maior distância que dava para voltar a pé se o veículo parasse.', label: 'NASA OCHMO-TB-023', url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf' },
      { text: 'O conceito atual da NASA mantém a regra: veículo não pressurizado a menos de 5 horas de caminhada. Para Marte, o raio ainda não foi definido.', label: 'NASA EVA-EXP-0042 Rev. B', url: 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'oxigenio',
    title: 'Oxigênio abaixo da reserva',
    trigger: 'Margem de oxigênio negativa para terminar o plano.',
    shelter: 'habitat',
    steps: [
      'Cancelar as paradas que faltam.',
      'Voltar pelo caminho de menor tempo, não pelo planejado.',
      'Manter passo constante e avisar a base a cada trecho.',
    ],
    evidence: [
      { text: 'O traje lunar atual da NASA é projetado para saídas de até 8 horas, com 1 hora de reserva. Para Marte a duração ainda não foi fixada.', label: 'NASA EVA-EXP-0042 Rev. B', url: 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf' },
    ],
    source: TEAM,
  },
  {
    id: 'atolamento',
    title: 'Atolamento ou roda danificada',
    trigger: 'Veículo patinando em areia ou com roda furada.',
    shelter: 'none',
    steps: [
      'Parar de acelerar: insistir afunda mais.',
      'Descer e avaliar o terreno a pé antes de qualquer manobra.',
      'Sem saída segura, tratar como pane do veículo.',
    ],
    evidence: [
      { text: 'O Opportunity atolou em 2005 porque seguia girando as rodas sem checar a posição e continuou cavando; sair levou mais de cinco semanas.', label: 'JPL, PIA07999', url: 'https://www.jpl.nasa.gov/images/pia07999-looking-back-at-purgatory-dune/' },
      { text: 'A Spirit ficou presa em 2009 ao romper uma crosta que escondia areia solta: o perigo não aparecia na superfície.', label: 'JPL, 12/11/2009', url: 'https://www.jpl.nasa.gov/news/nasa-to-begin-attempts-to-free-sand-trapped-mars-rover/' },
      { text: 'As rodas do Curiosity foram furadas por rochas pontiagudas presas ao solo; em 2022 o rover deu meia-volta diante do terreno de rochas cortantes do pedimento Greenheugh.', label: 'JPL, 07/04/2022', url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/' },
    ],
    source: TEAM,
  },
]);

export function protocolFor(id) {
  const protocol = PROTOCOLS.find((entry) => entry.id === id);
  if (!protocol) throw new Error(`Protocolo desconhecido: ${id}`);
  return protocol;
}
