// Paradas da missão "Seguir a água do Monte Sharp".
// Coordenadas e altitudes: posições do Curiosity no sol indicado (mapa oficial MMGIS).
export const STOPS = [
  {
    id: 'H', name: 'Habitat · unidade de argilas', short: 'Habitat', sol: 2449, lat: -4.7288545, lon: 137.3836581, el: -4144, ch: 'O lago',
    sci: 'Glen Torridon: argilas que se formaram na água de um lago antigo. Terreno plano para base e pouso.',
    q: 'Quanto tempo o lago durou e ele tinha condições para vida?',
    task: 'Amostra de referência das argilas, o ponto de partida da linha do tempo.',
    risk: null,
    imp: 'Argila se forma quando a rocha passa muito tempo em contato com água, em geral não ácida. Foi um ambiente potencialmente habitável. Vista da órbita, essa faixa tinha o sinal de argila mais forte da região e foi um dos motivos para escolher o Gale.',
    int: 'Argila é um dos melhores materiais para preservar moléculas orgânicas, e o Gale é onde o Curiosity encontrou orgânicos em Marte. Se sobrou algum vestígio químico de vida, aqui é um dos melhores lugares para procurar.',
  },
  {
    id: '1', name: 'Borda do Greenheugh Pediment', short: 'Greenheugh', sol: 2702, lat: -4.73706071, lon: 137.3807898, el: -4089, ch: 'A pausa',
    sci: 'Arenito depositado bem depois, sobre as camadas já erodidas da montanha.',
    q: 'Quanto tempo se passou entre o lago e o arenito, e o clima já era seco?',
    task: 'Fotografar e amostrar o contato entre arenito e argila.',
    risk: 'Subida íngreme na borda',
    imp: 'O contato registra uma lacuna no tempo: a montanha foi esculpida, passou muito tempo, e só depois o arenito se depositou, provavelmente trazido pelo vento. Marca a mudança de um mundo com água para um mundo de vento.',
    int: 'É um dos poucos lugares onde dá para pôr a mão na fronteira entre duas épocas. O terreno de rochas cortantes ao lado é um exemplo real de perigo para a rota.',
  },
  {
    id: '2', name: 'Crista de Gediz Vallis', short: 'Crista de Gediz', sol: 3974, lat: -4.77647482, lon: 137.4045524, el: -3764, ch: 'A água tardia',
    sci: 'Fluxos de detritos que desceram a montanha, entre os últimos episódios de água no Gale.',
    q: 'A água voltou depois que o lago secou? Quando e de onde?',
    task: 'Escolher e coletar blocos trazidos de camadas mais altas.',
    risk: 'Campo de blocos e declividade',
    imp: 'Os fluxos de água, lama e rochas aconteceram depois que a montanha já tinha boa parte da forma atual. Estão entre os episódios de água mais recentes do Gale: muito depois do lago, ainda havia água líquida em algum momento.',
    int: 'Os blocos vieram das partes altas da montanha, onde nenhum rover vai chegar. São amostras do topo sem precisar subir até lá, e escolher as mais variadas é julgamento rápido de campo, o forte do astronauta.',
  },
  {
    id: '3', name: 'Canal de Gediz Vallis · enxofre', short: 'Enxofre', sol: 4200, lat: -4.78570678, lon: 137.408864, el: -3688, ch: 'O mistério',
    sci: 'Pedras de enxofre puro, descobertas pelo Curiosity em 2024 e ainda sem origem explicada.',
    q: 'Que fluido formou o enxofre puro? Era água quente, e era habitável?',
    task: 'Coleta principal: pedras de enxofre e a rocha em volta, para análise na Terra.',
    risk: 'Blocos soltos e areia no canal',
    imp: 'Sulfatos são comuns no Gale, mas enxofre puro só se forma em condições específicas, e ninguém sabe ainda como ele surgiu ali. Foi a primeira vez que se encontrou enxofre puro em Marte, num campo inteiro dessas pedras.',
    int: 'Na Terra, enxofre puro aparece em ambientes vulcânicos ou de água quente, e também pode estar ligado a micróbios que processam enxofre. Não é prova de vida, mas é a pergunta em aberto que justifica trazer amostras para a Terra.',
  },
  {
    id: '4', name: 'Boxworks · entrada', short: 'Boxworks', sol: 4600, lat: -4.804189, lon: 137.3796858, el: -3633, ext: true, ch: 'A água subterrânea',
    sci: 'Cristas mineralizadas deixadas por água que circulou no subsolo (campanha de 2025–26).',
    q: 'A água persistiu no subsolo depois que a superfície secou?',
    task: 'Amostrar crista e depressão lado a lado para comparar.',
    risk: 'Cristas de 1–2 m e depressões com areia',
    imp: 'Os boxworks estão numa altura da montanha onde se esperava um Marte já bem seco. Mostram que, mesmo com a superfície seca, a água ainda circulava no subsolo. A rede de cristas se estende por 10–20 km.',
    int: 'O subsolo fica protegido da radiação e das variações de temperatura: um possível refúgio para vida quando a superfície já era hostil. Na Terra, formações parecidas aparecem em cavernas, como a Wind Cave, nos EUA.',
  },
  {
    id: '5', name: 'Contato boxwork / sulfatos', short: 'Sulfatos', sol: 4848, lat: -4.81155245, lon: 137.3818117, el: -3590, ext: true, ch: 'A secagem',
    sci: 'Camada rica em sulfatos, sais que se formaram quando a água evaporava. Fronteira atravessada em março de 2026.',
    q: 'Como foi a transição final para o Marte seco de hoje?',
    task: 'Amostra de sulfato, o fim da linha do tempo.',
    risk: 'Blocos espalhados, superfície poligonal',
    imp: 'Sulfatos se formam quando a água evapora, como o sal que sobra quando uma poça seca. Essas camadas registram a transição final para o Marte árido de hoje, uma das maiores mudanças climáticas de um planeta no Sistema Solar.',
    int: 'Fecha a linha do tempo: com as amostras de todas as paradas, a tripulação leva para a Terra uma sequência completa, do lago ao deserto, coletada num único lugar.',
  },
]

export const STOP = Object.fromEntries(STOPS.map((s) => [s.id, s]))

// Zona de rochas cortantes (gator-back): posição aproximada
export const HAZARD = { lat: -4.74867, lon: 137.39095, r: 0.25, name: 'Rochas cortantes (gator-back), aproximado' }
