// De onde vem cada informação do protótipo. É a lista única: o painel do tablet mostra esta lista
// e `node prototipo/tools/gerar-fontes.mjs` escreve docs/fontes.md a partir dela.
//
// Tipos:
// - medido: dado de uma sonda ou rover (MRO, Odyssey, Curiosity), com a fonte. "Missão" aqui seria ambíguo:
//   no projeto, missão é a nossa saída em Marte;
// - publicado: fato relatado em página da NASA ou em artigo científico, conferido na página de origem;
// - calculado: conta feita pela equipe sobre um dado medido;
// - estimado: curva ou proporção nossa apoiada em uma medição;
// - hipotese: escolha da equipe, sem medição por trás;
// - simulado: situação ou valor inventado para demonstrar a interface;
// - sistema: não é dado, é como o protótipo funciona (IA, voz, regras);
// - ilustrativo: só aparência.

export const KINDS = Object.freeze({
  medido: 'Dado de sonda ou rover',
  publicado: 'Fato publicado',
  calculado: 'Cálculo sobre dado real',
  estimado: 'Estimativa a partir de medição',
  hipotese: 'Hipótese da equipe',
  simulado: 'Simulado',
  sistema: 'Como o sistema funciona',
  ilustrativo: 'Ilustrativo',
});

const entry = (item, kind, source, url = null) => Object.freeze({ item, kind, source, url });

export const SOURCE_GROUPS = Object.freeze([
  Object.freeze({
    title: 'Mapa e terreno',
    entries: Object.freeze([
      entry('Relevo e altitude', 'medido', 'Modelo de elevação MSL Gale Merged DEM 1 m v3, feito com pares estéreo da câmera HiRISE (sonda MRO), de Calef & Parker, USGS. A equipe reamostrou para uma grade de 8 m.', 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m'),
      entry('Imagem colorida do mapa (2,5 m por pixel)', 'medido', 'Mosaico colorido da HiRISE (MRO) usado pela equipe do Curiosity, NASA/JPL-Caltech/UArizona. Os ladrilhos vieram do artifact original da equipe; o identificador do produto de origem não foi registrado.'),
      entry('Detalhe de 64 cm por pixel', 'medido', 'NASA Mars Trek, camada curiosity_hirise_mosaic (HiRISE, MRO). Lido da rede ao aproximar.', 'https://trek.nasa.gov/mars/'),
      entry('Detalhe de 25 cm por pixel', 'medido', 'MSL Gale Merged Orthophoto Mosaic 25 cm v3 (HiRISE, MRO), de Calef & Parker, USGS. Lido da rede ao aproximar.', 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm'),
      entry('Declividade', 'calculado', 'Classes de declive sobre o DEM de 1 m do USGS. A imagem veio pronta do artifact original; o programa que a gerou não está no repositório.'),
      entry('Térmico (noite)', 'medido', 'Infravermelho térmico noturno do THEMIS (sonda Mars Odyssey), mosaico de 100 m servido pelo NASA Mars Trek. É brilho relativo da imagem, não temperatura em graus.', 'https://trek.nasa.gov/mars/'),
      entry('Unidade geológica', 'medido', 'Mapa geológico global de Marte, USGS SIM 3292 (Tanaka et al. 2014), 1:20.000.000: a área inteira é a unidade Htu. Consultado em 14/11/2026.', 'https://doi.org/10.3133/sim3292'),
      entry('Trajeto do Curiosity', 'medido', 'Mapa oficial da missão (MMGIS, NASA/JPL), sols 2300 a 4893. Os pontos vieram do artifact original; a data da cópia não foi registrada.', 'https://mars.nasa.gov/maps/location/?mission=MSL'),
      entry('Posição atual do rover Curiosity', 'medido', 'Marcada com um R no mapa. Vem do arquivo que alimenta o mapa "Where is Curiosity?" da NASA, lido quando o protótipo abre; sem rede, vale a posição guardada em 15/11/2026 (sol 5073). O rover segue em operação: tratá-lo como parado no fim da missão dele é o cenário da equipe.', 'https://science.nasa.gov/mission/msl-curiosity/location-map/'),
      entry('Sombras do relevo', 'calculado', 'Sombra projetada pelo relevo do DEM para a posição calculada do Sol.'),
    ]),
  }),
  Object.freeze({
    title: 'Sol, clima e radiação',
    entries: Object.freeze([
      entry('Posição do Sol, nascer e pôr', 'calculado', 'Algoritmo Mars24 (Allison & McEwen 2000), do NASA GISS, para a estação de hoje em Marte. Não conta poeira nem refração.', 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html'),
      entry('Luz do dia que sobra para a saída', 'calculado', 'Hora do pôr do Sol (Mars24) menos a duração do plano.'),
      entry('Temperatura e pressão da estação', 'medido', 'REMS (Curiosity): média dos sols medidos na mesma estação do ano, lida do feed público da NASA. Sem rede, vale o sol típico de 2012 (JPL).', 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json'),
      entry('Temperatura por hora', 'estimado', 'Curva nossa entre a mínima (nascer do Sol) e a máxima (começo da tarde) medidas pelo REMS.'),
      entry('Radiação agora', 'medido', 'RAD (Curiosity): dose absorvida, média dos últimos 30 dias, lida da série msl_rad_dosimetry do NASA CCMC iSWA.', 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry'),
      entry('Taxa de radiação do visor e do mapa', 'medido', 'RAD (Curiosity): 0,67 mSv por dia de dose equivalente, média de agosto de 2012 a junho de 2013 (cerca de 27,9 µSv/h).', 'https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/'),
      entry('Radiação menor onde o relevo protege', 'estimado', 'Céu tapado pelo relevo (calculado no DEM) na proporção medida pelo RAD em Murray Buttes: 4% a menos com 19% do céu tapado (Ehresmann et al. 2021). Acima de 19% é extrapolação em linha reta.', 'https://doi.org/10.1029/2021JE006851'),
      entry('Evento solar (cenário de treino)', 'publicado', 'O disparo é um botão de treino. No evento de 11/09/2017 o RAD mediu mais que o dobro de qualquer valor anterior; aplicar 2 vezes sobre a média é simplificação da equipe.', 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/'),
      entry('Vento', 'publicado', 'Não há medição de vento para hoje: o sensor do REMS parou no sol 1491, e o visor mostra “sem medição”. O cenário de vento usa 27 m/s, os ventos mais fortes publicados para Marte, e calcula a força equivalente na Terra pela densidade do ar (pressão e temperatura do REMS).', 'https://www.nasa.gov/content/the-fact-and-fiction-of-martian-dust-storms'),
      entry('Tempestade de poeira (cenário de treino)', 'publicado', 'A visibilidade do cenário (menos de 3 km) é a medida em Gale no pico da tempestade global de 2018. O aviso de frente chegando em 40 min é parâmetro do treino.', 'https://arxiv.org/pdf/1910.00986'),
      entry('Frio extremo (cenário de treino)', 'publicado', 'O ar do cenário vai a −100 °C, o mais frio medido pelo REMS em dois anos marcianos.', 'https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/'),
    ]),
  }),
  Object.freeze({
    title: 'Rotas e segurança',
    entries: Object.freeze([
      entry('Distância, subida e declive das rotas', 'calculado', 'Caminho de menor custo sobre o DEM do USGS. A travessia do Monte Sharp veio pré-calculada do artifact original (DEM reamostrado a 2 m; o programa não está no repositório). A rota livre é calculada na hora, na grade de 8 m.'),
      entry('Velocidade a pé', 'publicado', '2 km/h: valor de planejamento da NASA para a volta a pé de traje (cerca de 10 km em 5 horas). Na rota livre, o efeito do declive usa a função de caminhada de Tobler (1993), feita para a Terra.', 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf'),
      entry('Velocidade do veículo e tempo de parada', 'hipotese', '4,5 km/h de veículo em terreno plano e 45 min por parada.'),
      entry('Limite de declive', 'hipotese', '20° a pé e 15° de veículo.'),
      entry('Volta a pé até o habitat', 'calculado', 'Tempo de caminhada sobre o DEM, com a velocidade a pé de planejamento da NASA.'),
      entry('Rádio', 'calculado', 'Linha de visada até o habitat sobre o DEM, com a curvatura de Marte. As alturas das antenas (10 m e 2 m) são hipótese.'),
      entry('Abrigo de relevo', 'calculado', 'Fração do céu tapada pelo relevo em volta, estimada sobre o DEM.'),
      entry('Simulação do plano a pé ou de veículo', 'calculado', 'A IA refaz o mesmo plano no outro modo, com as paradas de coleta: rota sobre o relevo real, velocidade reduzida pelo declive e oxigênio pelo consumo do traje. A velocidade do veículo, o declive máximo e o tempo de parada continuam sendo hipóteses da equipe.'),
      entry('Tempo que dá para ficar parado', 'calculado', 'Oxigênio de agora menos a reserva e o gasto do caminho, e a luz até o pôr do Sol. Usa o consumo de quem caminha: parado o gasto é menor, então é o mínimo garantido. Não achamos taxa metabólica publicada de astronauta parado de pé; só sentado no jipe lunar.'),
      entry('Pontos seguros para parar', 'calculado', 'Ponto mais próximo na rota, à frente e atrás, com chão de até 5° de declive, rádio direto com o habitat e fora da zona de rochas cortantes. O relevo e o rádio são calculados sobre o DEM; o critério é da equipe.'),
      entry('Zona de rochas cortantes', 'hipotese', 'O ponto é a posição oficial do Curiosity no sol 3420, onde a missão viu as rochas “gator-back” à frente e deu meia-volta. É a borda do terreno, não o centro, e não há contorno publicado: o círculo de 250 m é da equipe e cobre, a leste, chão por onde o rover passou sem problema.', 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/'),
      entry('Areia escura (fofa)', 'estimado', 'Camada Areia e desvio das rotas. Uma célula de 8 m conta como areia quando a imagem HiRISE ali é escura e mais azul que vermelha e o declive é menor que 12°; manchas com menos de 60 células são descartadas (2,48 km² no total). É classificação da equipe pela cor realçada da imagem, não mapa de areia da NASA, e pode marcar rocha escura como areia. Nas rotas livres a areia custa 2,5 vezes mais a pé e 8 vezes mais de veículo (hipótese da equipe). A travessia pronta veio do artifact original e não foi refeita: ela cruza 2,2 km dessa areia, e o painel avisa.'),
      entry('Oxigênio do traje', 'calculado', 'Não existe traje real, então não é medição. O consumo sai de uma conta: taxa metabólica medida nas saídas lunares da Apollo (1267 kJ por hora a pé, 414 no veículo), 20,9 kJ por litro de oxigênio e o tanque de 1,8 lb do traje avançado da NASA. Dá cerca de 10,6% por hora a pé e 3,5% no veículo.', 'https://ntrs.nasa.gov/api/citations/20120003917/downloads/20120003917.pdf'),
      entry('Tanque de oxigênio e pressão do traje', 'publicado', 'Tanque primário de cerca de 1,8 lb utilizável a 3000 psia (traje avançado da NASA, Campbell 2012) e pressão de operação de 4,3 psi (traje EMU da estação espacial).', 'https://ntrs.nasa.gov/api/citations/20120009158/downloads/20120009158.pdf'),
      entry('Reserva de oxigênio', 'calculado', '1 hora de contingência além da saída planejada, como no conceito de operações de saída da NASA (EVA-EXP-0042); a pé, isso dá 10,6% do tanque.', 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf'),
      entry('Bateria do traje', 'hipotese', 'Consumo de 9% por hora a pé e 5% no veículo. Não achamos a capacidade publicada em fonte primária.'),
      entry('Falhas do traje, do rádio e do veículo (cenários de treino)', 'simulado', 'Queda com vazamento, falha de tanque, rádio mudo e pane do veículo são situações hipotéticas, disparadas por botão para treinar os protocolos.'),
      entry('Posição do astronauta no visor', 'simulado', 'O protótipo move o astronauta ao longo da rota. Não há localização real: em Marte não existe GPS, e os rovers se localizam casando imagens com o mapa orbital.'),
      entry('Limites dos alertas', 'hipotese', 'Dose de 1.000 µSv por saída, traje até −60 °C, vento de 15 e 25 m/s, 10 min sem rádio, e a proteção de cada abrigo contra radiação.'),
      entry('Protocolos de emergência', 'hipotese', 'Proposta da equipe. Cada protocolo cita a evidência de missões reais reunida em docs/pesquisa.md.'),
    ]),
  }),
  Object.freeze({
    title: 'Ciência e visor',
    entries: Object.freeze([
      entry('Posição e altitude das paradas', 'medido', 'Pontos do trajeto do Curiosity (MMGIS, NASA/JPL).', 'https://mars.nasa.gov/maps/location/?mission=MSL'),
      entry('Textos científicos das paradas', 'publicado', 'Conferidos em 14/11/2026 contra páginas da NASA e do JPL e artigos científicos; a fonte de cada parada aparece no cartão. A parada 2 fica no furo Sequoia, a cerca de 300 m da crista de Gediz Vallis.'),
      entry('Perguntas e tarefas das paradas', 'hipotese', 'Roteiro escrito pela equipe.'),
      entry('Fotos nas paradas', 'medido', 'Navcam do Curiosity no sol da parada, do acervo de imagens brutas da missão (NASA/JPL-Caltech).', 'https://mars.nasa.gov/msl/multimedia/raw-images/'),
      entry('Coletas que deram trabalho ao rover', 'publicado', 'Relatos da missão Curiosity, conferidos em 14/11/2026; o link de cada caso está no cartão. Em quatro dos sete casos a missão conseguiu amostra depois, ali perto.'),
      entry('Objetivo da missão e local do habitat', 'hipotese', 'Proposta da equipe. O objetivo científico e o local seguem como decisões em aberto no README.'),
      entry('IA de bordo (visor e tablet)', 'sistema', 'Modelo de linguagem que faz o papel do computador de bordo. Não gera dado: recebe os valores desta lista a cada pergunta, consulta ferramentas e só pode citar número que veio delas (a resposta é conferida antes de aparecer). Recusa assunto fora da missão. Como o modelo é servido no protótipo está no README.'),
      entry('Alertas e protocolos do visor', 'sistema', 'Regras fixas sobre as leituras da saída. Não dependem da IA.'),
      entry('Voz do assistente', 'sistema', 'Fala: Kokoro-82M, modelo de voz neural (voz pf_dora, português do Brasil). Escuta: Whisper, que transcreve o que é dito no botão Falar. No protótipo aberto neste computador os dois rodam aqui mesmo e o áudio não sai da máquina; no site publicado, o texto da fala e o áudio da pergunta vão ao servidor do site. Sem o servidor de voz, valem a voz do sistema e o reconhecimento do navegador, se houver. Como a voz é servida está no README.', 'https://github.com/thewh1teagle/kokoro-onnx'),
      entry('Leituras fixadas no visor pela IA', 'sistema', 'A pedido do astronauta (“me mostra meu oxigênio”, “coloca na tela a velocidade média”, “tira o mapa”), a IA fixa ou tira leituras do visor e liga ou desliga o mapa, as leituras e o histórico. Os valores são os mesmos desta lista, lidos de novo duas vezes por segundo. Também pinta sobre o terreno do visor uma camada do mapa do tablet (térmico noturno, declive, rádio, radiação, volta a pé ou areia). Alertas, protocolo e a volta a pé não saem da tela.'),
      entry('Céu, chão além da área com dados e modelo do habitat', 'ilustrativo', 'Só aparência. Rochas soltas e montanhas desenhadas foram retiradas.'),
      entry('Modelo 3D do veículo', 'ilustrativo', 'Buggy aberto de dois lugares desenhado pela equipe com formas simples, na linha do jipe lunar da Apollo: o astronauta vai de traje, que é o que o protótipo assume para o consumo de oxigênio. Não vem de dado. O acervo de modelos 3D da NASA só tem o veículo pressurizado SEV, que não combina com essa hipótese.', 'https://github.com/nasa/NASA-3D-Resources'),
      entry('Grão do chão no visor', 'ilustrativo', 'Textura fina aplicada ao chão a até cerca de 40 m dos olhos, só no visor. A foto mais fina tem 25 cm por pixel e de perto vira um borrão; o grão devolve a noção de escala sem mudar a cor média. Não representa pedras reais.'),
    ]),
  }),
]);

// Como cada recurso da aba Resources do desafio entra no protótipo (página conferida em 14/11/2026).
export const CHALLENGE_RESOURCES = Object.freeze([
  Object.freeze({ name: 'JPL Mars Trek', url: 'https://trek.nasa.gov/mars/', use: 'Usado como dado: detalhe HiRISE de 64 cm e camada térmica THEMIS, lidos dos ladrilhos do Trek.' }),
  Object.freeze({ name: 'USGS-NASA Planetary Geologic Mapping', url: 'https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars', use: 'Usado como dado: unidade geológica da área (SIM 3292). Do mesmo USGS Astrogeology vêm o relevo e a ortofoto de 25 cm.' }),
  Object.freeze({ name: 'Curiosity’s Proposed Path up Mount Sharp', url: 'https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/', use: 'Usado como referência do roteiro (argilas, pediment, Gediz Vallis, sulfatos). Não é fonte de número.' }),
  Object.freeze({ name: 'NASA Worldview', url: 'https://worldview.earthdata.nasa.gov/', use: 'Usado só como referência de interface em camadas. Os dados são da Terra e não se aplicam a Marte.' }),
  Object.freeze({ name: 'Mars Perseverance Raw Images', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/', use: 'Não usado como dado: o Perseverance está na cratera Jezero, não em Gale. Para Gale usamos o acervo equivalente do Curiosity, do mesmo serviço de imagens brutas da NASA.' }),
]);

// Endereços dos dados que o protótipo lê ou copiou, além das páginas de cada fonte (conferidos em 14/11/2026).
export const DATA_ENDPOINTS = Object.freeze([
  Object.freeze({ label: 'DEM de 1 m de Gale (arquivo GeoTIFF de 3,6 GB, USGS)', url: 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif' }),
  Object.freeze({ label: 'Ortofoto de 25 cm de Gale (arquivo GeoTIFF de 24 GB, USGS)', url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif' }),
  Object.freeze({ label: 'Mars Trek: catálogo da camada HiRISE do Curiosity (WMTS)', url: 'https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml' }),
  Object.freeze({ label: 'Mars Trek: catálogo da camada THEMIS noturna (WMTS)', url: 'https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml' }),
  Object.freeze({ label: 'RAD: série de dose do Curiosity (dados em CSV, NASA CCMC)', url: 'https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/data?id=msl_rad_dosimetry&format=csv' }),
]);
