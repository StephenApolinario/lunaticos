// Traduções para o inglês da área "tablet". A chave é o texto em português como está no código,
// com {0}, {1}… no lugar de cada ${...}. Conferir com: node prototipo/tools/check-i18n.mjs
export default {
  // ---------- config.js: classes de declive, camadas e qualidade da imagem ----------
  'Declive acima de 20°': 'Slope above 20°',
  'Declive 15–20°': 'Slope 15–20°',
  'Declive 10–15°': 'Slope 10–15°',
  'Radiação': 'Radiation',
  '26,5 µSv/h': '26.5 µSv/h',
  '27,9 µSv/h': '27.9 µSv/h',
  'Radiação: média medida pelo RAD do Curiosity em Gale (0,67 mSv por dia, cerca de 27,9 µSv/h), reduzida onde o relevo tapa o céu. A proporção vem da medição do RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). O céu tapado é calculado sobre o relevo real. É estimativa, não medição ponto a ponto: o RAD só mede onde o rover está.':
    "Radiation: average measured by Curiosity's RAD in Gale (0.67 mSv per day, about 27.9 µSv/h), reduced where the terrain blocks the sky. The ratio comes from the RAD measurement at Murray Buttes: 4% less with 19% of the sky blocked (Ehresmann et al. 2021). The blocked sky is calculated on the real terrain. It is an estimate, not a point-by-point measurement: RAD only measures where the rover is.",
  'Térmico (noite)': 'Thermal (night)',
  'mais frio à noite': 'colder at night',
  'mais quente à noite': 'warmer at night',
  'Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m por pixel servido pelo NASA Mars Trek. Mais quente à noite indica rocha exposta; mais frio indica areia e poeira soltas. É brilho relativo da imagem, não temperatura em graus. Se a cor não aparecer, a imagem não pôde ser lida da rede.':
    'Nighttime thermal infrared from THEMIS (Mars Odyssey orbiter), a 100 m per pixel mosaic served by NASA Mars Trek. Warmer at night indicates exposed rock; colder indicates loose sand and dust. It is relative image brightness, not temperature in degrees. If the color does not appear, the image could not be read from the network.',
  'Volta a pé': 'Walk-back',
  'Tempo de caminhada até o habitat, calculado sobre o relevo real. A velocidade a pé é hipótese da equipe. Sem cor: longe de qualquer caminho a pé dentro do limite de declive.':
    'Walking time to the habitat, calculated on the real terrain. The walking speed is a team assumption. No color: far from any on-foot path within the slope limit.',
  'Rádio': 'Radio',
  'sem sinal direto': 'no direct signal',
  'com sinal direto': 'direct signal',
  'Linha de visada com o mastro do habitat, calculada sobre o relevo real. Alturas de antena (10 m no habitat, 2 m no traje) são hipótese da equipe.':
    'Line of sight to the habitat mast, calculated on the real terrain. Antenna heights (10 m on the habitat, 2 m on the suit) are a team assumption.',
  'Areia fofa': 'Soft sand',
  'chão firme (sem cor)': 'firm ground (no color)',
  'areia escura': 'dark sand',
  'Areia escura estimada pela equipe: onde a imagem HiRISE é escura e azulada e o chão é pouco inclinado. Não é mapa de areia da NASA. A rota prefere outro caminho, porque a areia fofa cansa quem anda e pode atolar o veículo.':
    'Dark sand estimated by the team: where the HiRISE image is dark and bluish and the ground slopes little. It is not a NASA sand map. The route prefers another path, because soft sand tires walkers and can bog down the vehicle.',
  'Mínima¦qualidade': 'Minimum',
  'Média¦qualidade': 'Medium',
  'Alta¦qualidade': 'High',
  'Foto de 2,5 m por pixel, sem sombra projetada. Leve em qualquer computador.': '2.5 m per pixel photo, no cast shadows. Light on any computer.',
  'Foto de 0,7 m por pixel já pronta (nítida de longe, sem buscar na rede) e sombras do relevo.': 'Ready-made 0.7 m per pixel photo (sharp from afar, nothing fetched from the network) and terrain shadows.',
  'Foto de 0,7 m, sombras suaves e, de perto, a imagem de 25 cm lida da rede. Pesa em computadores modestos.': '0.7 m photo, soft shadows and, up close, the 25 cm image read from the network. Heavy on modest computers.',

  // ---------- globo-camadas.js, globo-marcador.js: Marte inteiro ----------
  'Viking Orbiter 1 e 2': 'Viking Orbiter 1 and 2',
  'Área mapeada': 'Mapped area',
  'Entrar na área mapeada: {0}': 'Enter the mapped area: {0}',

  // ---------- luz.js: rumos ----------
  'norte': 'north',
  'nordeste': 'northeast',
  'leste': 'east',
  'sudeste': 'southeast',
  'sul': 'south',
  'sudoeste': 'southwest',
  'oeste': 'west',
  'noroeste': 'northwest',

  // ---------- main.js: selo do mapa, barra de estado e avisos ----------
  'Cratera Gale · Monte Sharp': 'Gale Crater · Mount Sharp',
  'Escolha um ponto dentro da área fotografada do mapa.': 'Choose a point inside the photographed area of the map.',
  'relevo real (USGS)': 'real terrain (USGS)',
  'altura do relevo aproximada': 'approximate terrain height',
  'Carregando imagem HiRISE…': 'Loading HiRISE image…',
  'Imagem HiRISE e relevo reais (USGS)': 'Real HiRISE image and terrain (USGS)',
  'Imagem HiRISE real': 'Real HiRISE image',
  'sem rede para o detalhe fino': 'no network for fine detail',
  'detalhe de {0} por pixel': 'detail at {0} per pixel',
  'foto de 0,7 m por pixel': '0.7 m per pixel photo',
  'Imagem HiRISE indisponível': 'HiRISE image unavailable',
  'Ls {0}° · estação de hoje': "Ls {0}° · today's season",
  'Partida {0} · hora solar local': 'Departure {0} · local solar time',
  'Imagem do planeta: fotos das sondas {0} (NASA, anos 1970), reunidas pelo USGS num mosaico de 232 m por pixel e lidas do NASA Mars Trek.':
    'Planet image: photos from the {0} spacecraft (NASA, 1970s), assembled by the USGS into a 232 m per pixel mosaic and read from NASA Mars Trek.',
  'A rota livre aceita até {0} pontos. Remova um para escolher outro.': 'The free route takes up to {0} points. Remove one to choose another.',
  'fora do ar': 'offline',
  'erro desconhecido': 'unknown error',
  'Não foi possível iniciar o mapa 3D: {0}': 'Could not start the 3D map: {0}',

  // ---------- overlays.js: pinos do mapa ----------
  'Rover Curiosity · posição publicada pela NASA (sol {0})': 'Curiosity rover · position published by NASA (sol {0})',
  'Astronauta · {0} de saída · posição simulada': 'Astronaut · {0} into the EVA · simulated position',

  // ---------- planner.js: rota livre ----------
  'Escolha um ponto a mais de {0} m do anterior e do habitat.': 'Choose a point more than {0} m from the previous one and from the habitat.',
  'A rota livre aceita até {0} pontos.': 'The free route takes up to {0} points.',
  'Não há caminho a pé até o ponto {0} dentro do limite de declive.': 'There is no on-foot path to point {0} within the slope limit.',
  'Não há caminho a pé até o habitat, na volta do ponto {0} dentro do limite de declive.': 'There is no on-foot path to the habitat, on the way back from point {0}, within the slope limit.',
  'O veículo não alcança o ponto {0} dentro do limite de declive. Tente a pé ou escolha outro ponto.': 'The vehicle cannot reach point {0} within the slope limit. Try on foot or choose another point.',
  'O veículo não alcança o habitat, na volta do ponto {0} dentro do limite de declive. Tente a pé ou escolha outro ponto.': 'The vehicle cannot reach the habitat, on the way back from point {0}, within the slope limit. Try on foot or choose another point.',
  'Ponto {0}': 'Point {0}',
  'Ponto escolhido no mapa': 'Point chosen on the map',
  'Ponto escolhido pela tripulação. A rota foi calculada na hora sobre o relevo real.': 'Point chosen by the crew. The route was calculated on the spot on the real terrain.',
  'O que chamou a atenção aqui e que o rover não registrou?': 'What caught your attention here that the rover did not record?',
  'Descrever o local, fotografar e decidir se vale uma coleta.': 'Describe the site, photograph it and decide whether it is worth sampling.',

  // ---------- simulation.js: alvo, alertas e frases do copiloto ----------
  'Em coleta · parada {0}': 'Sampling · stop {0}',
  'Próxima parada · {0}': 'Next stop · {0}',
  'Retorno': 'Return',
  'à direita': 'to the right',
  'à esquerda': 'to the left',
  'à frente': 'ahead',
  'atrás': 'behind',
  'Evento solar · dose {0}× acima do normal': 'Solar event · dose {0}× above normal',
  'O₂ insuficiente para o plano · faltam {0}': 'Not enough O₂ for the plan · {0} short',
  'Margem de O₂ baixa · {0}': 'Low O₂ margin · {0}',
  'Rochas cortantes a {0} {1}': 'Sharp rocks {0} {1}',
  'Declive de {0}° à frente': '{0}° slope ahead',
  'Travessia concluída. Você está de volta ao habitat.': 'Traverse complete. You are back at the habitat.',
  'Evento solar em curso. Volte ao habitat pelo caminho mais curto: {0}, cerca de {1}.': 'Solar event in progress. Return to the habitat by the shortest path: {0}, about {1}.',
  'O oxigênio não cobre este plano: faltam {0} de autonomia.': 'The oxygen does not cover this plan: it falls {0} short.',
  'Encurte a rota ou troque para o veículo.': 'Shorten the route or switch to the vehicle.',
  'Encurte a rota.': 'Shorten the route.',
  'Parada {0}, {1}. Tarefa: {2}': 'Stop {0}, {1}. Task: {2}',
  'Rochas cortantes a {0} {1}. Mantenha-se na rota marcada.': 'Sharp rocks {0} {1}. Stay on the marked route.',
  'Declive de {0}° nos próximos {1} m. Reduza o passo e firme o apoio.': '{0}° slope in the next {1} m. Slow your pace and keep a firm footing.',
  'Coletas concluídas. Siga {0} de volta ao habitat, chegada em {1}.': 'Sampling complete. Continue {0} back to the habitat, arriving in {1}.',
  'Siga {0} até {1}. Chegada em {2}.': 'Continue {0} to {1}. Arrival in {2}.',

  // ---------- tablet.js: cabeçalho ----------
  'Cratera Gale · Monte Sharp · Marte': 'Gale Crater · Mount Sharp · Mars',
  'Das argilas ao enxofre': 'From the clays to the sulfur',
  'Rota de exploração humana calculada sobre o relevo real, ao lado do trajeto do Curiosity (2019–2026). Planeje aqui e siga a rota pelo visor do capacete.':
    "Human exploration route calculated on the real terrain, alongside Curiosity's path (2019–2026). Plan here and follow the route in the helmet visor.",
  'Objetivo da missão': 'Mission objective',
  'Seguir a água do Monte Sharp:': 'Follow the water of Mount Sharp:',
  'reconstruir quando e como Marte perdeu a água líquida, e trazer as amostras com mais chance de guardar sinais de vida.':
    'reconstruct when and how Mars lost its liquid water, and bring back the samples most likely to preserve signs of life.',
  'Entrar no visor do capacete': 'Enter helmet visor',
  'Variante do visor': 'Visor variant',
  'Qualidade da imagem': 'Image quality',

  // ---------- tablet.js: IA de planejamento ----------
  'IA de planejamento': 'Planning AI',
  'verificando…': 'checking…',
  'Conversa com a IA de planejamento': 'Conversation with the planning AI',
  'Pergunte sobre o plano ou peça uma mudança…': 'Ask about the plan or request a change…',
  'Enviar': 'Send',
  'Responde só com os dados do plano e das fontes, e muda o plano quando você pede.': 'Answers only with data from the plan and the sources, and changes the plan when you ask.',
  'Pedidos de exemplo': 'Sample requests',
  'Pedido para a IA de planejamento': 'Request for the planning AI',

  // ---------- tablet.js: modo e camadas ----------
  'A pé': 'On foot',
  'Veículo': 'Vehicle',
  'Incluir extensão até os boxworks': 'Include extension to the boxworks',
  'Modo de deslocamento': 'Travel mode',
  'Modo': 'Mode',
  'Camadas do mapa': 'Map layers',
  'Camada exibida': 'Layer shown',
  'Relevo': 'Terrain',
  'Declividade': 'Slope',
  'Térmico': 'Thermal',
  'Areia': 'Sand',
  'Imagem HiRISE e relevo reais. A altura vem do modelo de elevação de 1 m do USGS, em grade de 8 m.': 'Real HiRISE image and terrain. The height comes from the USGS 1 m elevation model, on an 8 m grid.',
  'Imagem HiRISE real. A altura do relevo é aproximada: fiel ao longo das rotas, suavizada entre elas.': 'Real HiRISE image. The terrain height is approximate: faithful along the routes, smoothed between them.',
  'Relevo real (USGS). A cor do solo é ilustrativa: a imagem não está carregada.': 'Real terrain (USGS). The ground color is illustrative: the image is not loaded.',
  'Cor do solo ilustrativa. O relevo é aproximado, ancorado nas altitudes reais das rotas.': 'Illustrative ground color. The terrain is approximate, anchored to the real elevations of the routes.',
  'Declive real, calculado sobre o modelo de elevação de 1 m do USGS.': 'Real slope, calculated on the USGS 1 m elevation model.',
  'Declive do relevo ilustrativo: a imagem real não está carregada.': 'Slope of the illustrative terrain: the real image is not loaded.',

  // ---------- tablet.js: resumo da rota e trechos ----------
  'Resumo da rota': 'Route summary',
  'distância de ida': 'outbound distance',
  'total com retorno': 'total with return',
  'tempo estimado': 'estimated time',
  'subida acumulada': 'cumulative climb',
  'declive máximo': 'maximum slope',
  'paradas científicas': 'science stops',
  'Estimativa: {0} km/h com traje e carga, {1} min por parada. Rota evita declives acima de {2}°.': 'Estimate: {0} km/h with suit and load, {1} min per stop. The route avoids slopes above {2}°.',
  'Estimativa: veículo a {0} km/h, {1} min por parada a pé. Rota evita declives acima de {2}° e a zona de rochas cortantes.': 'Estimate: vehicle at {0} km/h, {1} min per stop on foot. The route avoids slopes above {2}° and the sharp-rock zone.',
  'Trechos em vermelho exigem declive acima de {0}°: o veículo para antes e a equipe segue a pé.': 'Legs in red require slopes above {0}°: the vehicle stops short and the team continues on foot.',
  'Rota calculada no navegador sobre a grade de 8 m: blocos e cristas menores que isso não aparecem, então ela é mais grosseira que as pré-calculadas em 2 m.':
    'Route calculated in the browser on the 8 m grid: blocks and ridges smaller than that do not show up, so it is coarser than the ones precalculated at 2 m.',
  'Trechos': 'Legs',
  'Trecho': 'Leg',
  'Dist.': 'Dist.',
  'Subida': 'Climb',
  'Decl. máx.': 'Max slope',
  'a pé': 'on foot',
  'Retorno ao habitat': 'Return to habitat',

  // ---------- tablet.js: paradas ----------
  'Paradas': 'Stops',
  'Ver no mapa': 'Show on map',
  'extensão': 'extension',
  'Fonte:': 'Source:',
  'Pergunta': 'Question',
  'Tarefa': 'Task',
  'Por que essa parada importa': 'Why this stop matters',
  'Importância': 'Importance',
  'O que a torna interessante': 'What makes it interesting',
  'O que o Curiosity viu aqui (sol {0})': 'What Curiosity saw here (sol {0})',
  'Buscando no acervo da NASA…': 'Searching the NASA archive…',
  'Nenhuma foto da Navcam neste sol.': 'No Navcam photos on this sol.',
  'Foto da Navcam do Curiosity no sol {0}': 'Curiosity Navcam photo on sol {0}',
  'Não foi possível buscar as fotos agora. Verifique a rede e abra de novo.': 'Could not fetch the photos right now. Check the network and open again.',
  'Fotos brutas da Navcam, do acervo público da missão · NASA/JPL-Caltech.': "Raw Navcam photos from the mission's public archive · NASA/JPL-Caltech.",

  // ---------- tablet.js: rota livre ----------
  'Rota livre': 'Free route',
  'Clique no mapa, sem arrastar: cada clique vira a próxima parada (A, B, C… até {0}). A rota sai do habitat, passa por todas na ordem e volta, calculada na hora sobre o relevo real.':
    'Click the map, without dragging: each click becomes the next stop (A, B, C… up to {0}). The route leaves the habitat, passes through all of them in order and returns, calculated on the spot on the real terrain.',
  'Pontos da rota, na ordem da visita': 'Route points, in visiting order',
  '{0}, {1} · {2} m · {3} de rota': '{0}, {1} · {2} m · {3} along the route',
  'Remover o ponto {0}': 'Remove point {0}',
  'Remover': 'Remove',
  'A rota é a mais segura: foge das encostas e evita onde não há rádio direto com o habitat.': 'The route is the safest one: it stays away from the slopes and avoids places with no direct radio to the habitat.',
  'Voltar à travessia do Monte Sharp': 'Back to the Mount Sharp traverse',

  // ---------- tablet.js: hora do dia, luz e frio ----------
  'Hora do dia': 'Time of day',
  'Hora solar local em que a saída começa': 'Local solar time when the EVA starts',
  'Sol calculado para a estação de hoje em Marte (Ls {0}°) com o algoritmo Mars24 da NASA: nasce às {1} e se põe às {2}, sem contar a poeira.':
    "Sun calculated for today's season on Mars (Ls {0}°) with NASA's Mars24 algorithm: it rises at {1} and sets at {2}, not counting dust.",
  'As sombras são as do relevo real.': 'The shadows are those of the real terrain.',
  'Na qualidade mínima as encostas escurecem conforme o Sol, sem sombra projetada.': 'At minimum quality the slopes darken with the Sun, with no cast shadows.',
  'Sol a {0}° de altura, a {1} · calculado': 'Sun {0}° above the horizon, to the {1} · calculated',
  'Sol abaixo do horizonte · calculado': 'Sun below the horizon · calculated',
  'Ar {0} °C · solo {1} °C · estimado entre os extremos do REMS': 'Air {0} °C · ground {1} °C · estimated between the REMS extremes',
  'Às {0} está escuro: a saída começaria sem luz do Sol.': 'At {0} it is dark: the EVA would start without sunlight.',
  'Saindo às {0}, a saída termina às {1}, {2} depois do pôr do Sol.': 'Leaving at {0}, the EVA ends at {1}, {2} after sunset.',
  'Saindo às {0}, a saída termina às {1} e sobram {2} de luz.': 'Leaving at {0}, the EVA ends at {1} with {2} of daylight left.',
  'O ar fica acima do mínimo do traje ({0} °C, hipótese da equipe) a saída inteira.': 'The air stays above the suit minimum ({0} °C, team assumption) for the whole EVA.',
  'Frio abaixo do mínimo do traje ({0} °C, hipótese da equipe) a partir das {1}, antes do fim da saída: chega a {2} °C. Saia mais cedo ou encurte a rota.':
    'Cold below the suit minimum ({0} °C, team assumption) from {1}, before the end of the EVA: it reaches {2} °C. Leave earlier or shorten the route.',
  'Frio abaixo do mínimo do traje ({0} °C, hipótese da equipe) desde a partida: chega a {1} °C.': 'Cold below the suit minimum ({0} °C, team assumption) from departure: it reaches {1} °C.',
  'Hoje o ar não chega a esse mínimo.': 'Today the air does not reach that minimum.',
  'O ar só passa do mínimo às {0}: saia depois desse horário.': 'The air only rises above the minimum at {0}: leave after that time.',

  // ---------- tablet.js: medições do Curiosity ----------
  'Medições do Curiosity em Gale': 'Curiosity measurements in Gale',
  'Temperatura e pressão nesta estação do ano: ar de {0} a {1}, solo de {2} a {3}, pressão de {4} Pa. Média de {5} sols medidos pelo REMS com a estação a até {6}° da de hoje (último sol do feed: {7}).':
    "Temperature and pressure in this season: air from {0} to {1}, ground from {2} to {3}, pressure of {4} Pa. Average of {5} sols measured by REMS with the season within {6}° of today's (last sol in the feed: {7}).",
  'Temperatura ({0}): em um sol típico do início da missão, ar de {1} a {2} e solo de {3} a {4}.': 'Temperature ({0}): on a typical sol early in the mission, air from {1} to {2} and ground from {3} to {4}.',
  'Radiação agora: {0} µGy por dia de dose absorvida, média das {1} leituras do RAD nos {2} dias até {3}.': 'Radiation now: {0} µGy per day of absorbed dose, average of the {1} RAD readings in the {2} days up to {3}.',
  'Radiação ({0}): {1} mSv por dia de dose equivalente, média de agosto de 2012 a junho de 2013.': 'Radiation ({0}): {1} mSv per day of dose equivalent, average from August 2012 to June 2013.',
  'lendo da NASA; por enquanto, valor de reserva': 'reading from NASA; fallback value for now',
  'sem rede, valor de reserva': 'no network, fallback value',
  'Geologia: toda a área fica em uma só unidade do mapa geológico global de Marte (1:20.000.000), a Htu, “Hesperian transition undivided unit”. O mapa de detalhe da região (Aeolis Mons, 1:60.000) ainda está em preparação.':
    'Geology: the whole area lies in a single unit of the global geologic map of Mars (1:20,000,000), Htu, the “Hesperian transition undivided unit”. The detailed map of the region (Aeolis Mons, 1:60,000) is still in preparation.',

  // ---------- tablet.js: segurança da saída ----------
  'Segurança da saída': 'EVA safety',
  'O oxigênio cobre a volta a pé de qualquer ponto da rota, com {0}% de reserva.': 'The oxygen covers the walk-back from any point on the route, with a {0}% reserve.',
  'Menor folga: {0}.': 'Smallest margin: {0}.',
  'A partir de {0} de rota, não há caminho a pé até o habitat dentro do limite de declive.': 'From {0} along the route, there is no on-foot path to the habitat within the slope limit.',
  'A partir de {0} de rota, o oxigênio não cobre mais a volta a pé ({1} de caminhada até o habitat).': 'From {0} along the route, the oxygen no longer covers the walk-back ({1} of walking to the habitat).',
  'Se o veículo quebrar depois desse ponto, a tripulação não volta sozinha.': 'If the vehicle breaks down past that point, the crew cannot get back on its own.',
  'Depois desse ponto, a única saída é terminar a rota.': 'Past that point, the only way out is to finish the route.',
  '{0} da rota ({1}%) sem linha de visada com o habitat, em 1 trecho. Sem repetidor, não há rádio direto ali.': '{0} of the route ({1}%) with no line of sight to the habitat, in 1 stretch. Without a repeater, there is no direct radio there.',
  '{0} da rota ({1}%) sem linha de visada com o habitat, em {2} trechos. Sem repetidor, não há rádio direto ali.': '{0} of the route ({1}%) with no line of sight to the habitat, in {2} stretches. Without a repeater, there is no direct radio there.',
  'Toda a rota tem linha de visada com o habitat.': 'The whole route has line of sight to the habitat.',
  '{0} da rota passam por areia escura (estimada pela cor da imagem; veja a camada Areia). A pé cansa mais; de veículo há risco de atolar.':
    '{0} of the route runs through dark sand (estimated from the image color; see the Sand layer). On foot it is more tiring; in a vehicle there is a risk of getting stuck.',
  'Abrigo no ponto mais afastado': 'Shelter at the farthest point',
  'Habitat a {0} em linha reta, {1} a pé.': 'Habitat {0} away in a straight line, {1} on foot.',
  'Proteção de relevo a {0}: a encosta tapa {1}% do céu (estimativa geométrica).': 'Terrain shelter {0} away: the slope blocks {1}% of the sky (geometric estimate).',
  'Sem proteção de relevo a menos de 1,5 km.': 'No terrain shelter within 1.5 km.',
  'Calculado sobre o relevo real. O consumo de oxigênio é calculado com a taxa metabólica medida na Apollo e o tanque do traje avançado da NASA; a reserva de {0}% é 1 hora de contingência. São hipóteses da equipe as antenas de {1} m no habitat e {2} m no traje.':
    "Calculated on the real terrain. Oxygen consumption is calculated with the metabolic rate measured on Apollo and the tank of NASA's advanced suit; the {0}% reserve is 1 hour of contingency. The {1} m antenna on the habitat and the {2} m antenna on the suit are team assumptions.",
  'A regra da volta a pé vem das Apollo: o jipe lunar podia rodar 92 km, mas ninguém passou de 7,6 km do módulo.': 'The walk-back rule comes from Apollo: the lunar rover could drive 92 km, but no one went more than 7.6 km from the module.',
  'O que fazer em cada cenário': 'What to do in each scenario',
  'Gatilho: {0}': 'Trigger: {0}',
  'Abrigo: {0} · Passos: {1}': 'Shelter: {0} · Steps: {1}',

  // ---------- tablet.js: onde a coleta do rover deu trabalho ----------
  'Onde a coleta do rover deu trabalho': "Where the rover's sampling ran into trouble",
  'Perfurações do Curiosity nesta região que falharam ou ficaram incompletas na primeira tentativa; o texto de cada caso diz como terminou. A posição é a do rover naquele sol, tirada do trajeto real. Para a equipe, mostram o que uma tripulação resolveria na hora: escolher outra rocha, firmar o bloco ou usar outra ferramenta.':
    "Curiosity drill attempts in this region that failed or were left incomplete on the first try; the text of each case says how it ended. The position is the rover's on that sol, taken from the real path. For the team, they show what a crew would solve on the spot: pick another rock, steady the block or use another tool.",
  'tentativa no sol {0} · {1}': 'attempt on sol {0} · {1}',
  'tentativa no sol {0} · {1} (posição do rover no sol {2})': 'attempt on sol {0} · {1} (rover position on sol {2})',
  'Adicionar à rota': 'Add to route',

  // ---------- tablet.js: perfil, legenda e fontes ----------
  'Perfil de altitude da rota': 'Route elevation profile',
  'Altitude ao longo da rota calculada': 'Elevation along the calculated route',
  'Altitude (m) pela distância percorrida na ida, lida do mapa de altitude real. Para comparar: o Curiosity rodou cerca de 11 km entre o habitat e o canal de enxofre.':
    'Elevation (m) by distance traveled on the way out, read from the real elevation map. For comparison: Curiosity drove about 11 km between the habitat and the sulfur channel.',
  'Legenda': 'Legend',
  'Trajeto do Curiosity': "Curiosity's path",
  'Rota a pé (calculada)': 'On-foot route (calculated)',
  'Rota de veículo (calculada)': 'Vehicle route (calculated)',
  'Zona de exclusão da equipe (250 m) em volta das rochas cortantes': "Team's exclusion zone (250 m) around the sharp rocks",
  'As rotas são o caminho de menor custo sobre o mapa de altitude de 1 m do USGS (reamostrado para 2 m). O custo pesa declividade, rugosidade e a zona de rochas cortantes. A zona de rochas é aproximada, e blocos menores que cerca de 2 m não aparecem no mapa de altitude.':
    'The routes are the least-cost path over the USGS 1 m elevation map (resampled to 2 m). The cost weighs slope, roughness and the sharp-rock zone. The rock zone is approximate, and blocks smaller than about 2 m do not show up on the elevation map.',
  'De onde vem cada informação': 'Where each piece of information comes from',
  'O arquivo de relevo real não carregou: a altura do relevo entre as rotas está aproximada.': 'The real terrain file did not load: the terrain height between the routes is approximate.',
  'fonte': 'source',
  'Recursos do desafio ({0})': 'Challenge resources ({0})',
};
