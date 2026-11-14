# Pesquisa: lições de missões de superfície para o planejador de travessias (Gale / Monte Sharp)

Data da pesquisa: 14/11/2026

Como os fatos foram conferidos: cada fato foi lido na própria página (ou no PDF, extraído com `pdftotext`) do link que está ao lado dele. Quando a página não abriu, o fato veio do resultado da busca e está marcado com "(não conferido na página)". O que não teve fonte está como "não encontrado". Nada foi preenchido de memória.

Notas de leitura:

- As páginas do Apollo Lunar Surface Journal em `hq.nasa.gov/alsj` e `nasa.gov/history/alsj` hoje redirecionam para uma página inicial. Os links do ALSJ abaixo usam `apollojournals.org`, o endereço para onde essa página da NASA aponta.
- Conversões de unidade feitas por nós estão marcadas como "conversão nossa".
- "Região" = área percorrida pelo Curiosity entre os sols ~2300 e ~4900 (Glen Torridon, pedimento Greenheugh, crista e canal de Gediz Vallis, terreno boxwork).

---

## A. Problemas a evitar (lições de missões de superfície)

### 1. Como a Spirit atolou em "Troy" (2009) e a Opportunity na duna "Purgatory" (2005)

- A Spirit ficou presa em "Troy" em 23/04/2009: andava de ré, arrastando a roda dianteira direita (inoperante desde 2006), quando as outras rodas romperam uma crosta superficial e afundaram na areia clara e escorregadia que havia por baixo. [JPL, 12/11/2009](https://www.jpl.nasa.gov/news/nasa-to-begin-attempts-to-free-sand-trapped-mars-rover/)
- O terreno era a borda de uma cratera enterrada de 26 pés de largura (≈ 8 m, conversão nossa), preenchida por areia com sulfatos e coberta por solo em crosta, ou seja, o perigo não aparecia na superfície. [JPL, 12/11/2009](https://www.jpl.nasa.gov/news/nasa-to-begin-attempts-to-free-sand-trapped-mars-rover/)
- As rodas cavaram além da altura do cubo ("more than hub deep") em camadas de areia basáltica, areia rica em sulfato (ferro principalmente como sulfato férrico) e material rico em sílica. [JPL, 25/06/2009](https://www.jpl.nasa.gov/news/mars-rover-yielding-new-clues-while-lodged-in-martian-soil/)
- A NASA encerrou as tentativas de soltar a Spirit, e a missão, em 25/05/2011. [JPL, página da missão](https://www.jpl.nasa.gov/missions/mars-exploration-rover-spirit-mer-spirit/)
- Opportunity: em 26/04/2005 (sol 446) as rodas afundaram mais de 10 cm no material arenoso e macio de uma ondulação de vento (ripple) de cerca de 1/3 m de altura e 2,5 m de largura; sair de lá levou mais de cinco semanas de planejamento, testes e condução monitorada. [JPL, PIA07999](https://www.jpl.nasa.gov/images/pia07999-looking-back-at-purgatory-dune/)
- Causa e regra: o rover andava em "blind driving" (girava as rodas um número fixo de voltas sem checar a posição) e continuou cavando; John Callas, da equipe, disse que não se avaliava bem o perigo dessas dunas e que elas deixaram de ser cruzadas daquele modo [NASA, podcast On a Mission](https://www.nasa.gov/podcasts/on-a-mission/a-lifetime-on-mars-the-adventures-of-spirit-and-opportunity-s4e4/); os planejadores passaram a incluir checagens de escorregamento com as câmeras do rover [JPL Robotics](https://www-robotics.jpl.nasa.gov/news/learning-to-drive-the-mars-rovers/).

### 2. O que danificou as rodas do Curiosity, em que terreno, e o que mudou

- Em 2013 amassados e furos nas rodas de alumínio passaram a se acumular mais rápido que o esperado; a causa apontada são rochas pontiagudas e encravadas no solo ao longo da rota. [JPL, 21/03/2017](https://www.jpl.nasa.gov/news/breaks-observed-in-rover-wheel-treads/)
- Mecanismo: quando uma roda sobe numa rocha pontiaguda presa ao chão, as outras rodas a empurram ou puxam contra a rocha; a parte mais vulnerável é a chapa entre as garras (grousers). [JPL, 2017](https://www.jpl.nasa.gov/news/an-algorithm-helps-protect-mars-curiositys-wheels/)
- Limite de vida: testes em Terra indicam que três garras quebradas numa roda equivalem a cerca de 60% da vida útil; duas quebraram na roda central esquerda (vistas em 19/03/2017, com 16,0 km rodados) [JPL, 21/03/2017](https://www.jpl.nasa.gov/news/breaks-observed-in-rover-wheel-treads/) e em 02/08/2021 eram quatro, três na central esquerda e uma na central direita [NTRS 20230005728](https://ntrs.nasa.gov/citations/20230005728).
- Software: o algoritmo de controle de tração (enviado ao rover em março de 2017, aprovado em 8 de junho) ajusta a velocidade de cada roda a partir dos ângulos da suspensão e, em teste, reduziu a carga em 20% nas rodas dianteiras e 11% nas centrais [JPL, 2017](https://www.jpl.nasa.gov/news/an-algorithm-helps-protect-mars-curiositys-wheels/); a atualização concluída em 07/04/2023 (cerca de 180 mudanças) trouxe dois comandos que reduzem o esterçamento e, com isso, o desgaste [JPL, 2023](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-gets-a-major-software-upgrade/).
- Regras de condução: desde 2013 os planejadores mapeiam o terreno perigoso para desviar dele [JPL, 21/03/2017](https://www.jpl.nasa.gov/news/breaks-observed-in-rover-wheel-treads/), e as rodas são fotografadas periodicamente desde 30/11/2013, o que alimenta as diretrizes de condução [NTRS 20230005728](https://ntrs.nasa.gov/citations/20230005728).
- Terreno "gator-back" (dorso de jacaré): ventifactos de arenito, a rocha mais dura que o Curiosity encontrou, no pedimento Greenheugh (fotos de 15/03/2022, sol 3415); em 18/03/2022 a equipe decidiu dar meia-volta porque o terreno, embora transponível, seria lento, envelheceria as rodas e impediria as boas práticas de condução. [JPL, 07/04/2022](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/)

### 3. Problemas do jipe lunar (LRV) e dos trajes Apollo na superfície

- Em três ocasiões nas Apollo 15–17 um para-lama do LRV quebrou, e tripulação e equipamentos ficaram cobertos de poeira durante a condução. [NASA OCHMO-TB-023, p. 2](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf)
- Apollo 17: o martelo de Cernan prendeu no para-lama traseiro direito (118:51:20) e arrancou a extensão; o remendo com fita falhou por volta de 122:47:48; o substituto, feito de mapas, fita e grampos, começou a falhar em ~167:41:11, depois de cerca de 29 km. [ALSJ, Apollo 17 Replacement Fender](https://apollojournals.org/alsj/a17/A17NewFender.html)
- Térmico: nas Apollo 16 e 17 as baterias do LRV passaram do limite de temperatura por poeira nos radiadores, e escovar quase não adiantou (ao contrário do que os testes em solo indicavam); na Apollo 15 as baterias rodaram 68 a 78 °F acima do previsto. [Gaier, NASA/TM-2005-213610](https://ntrs.nasa.gov/api/citations/20050160460/downloads/20050160460.pdf)
- Vedação do traje: na Apollo 12 o traje de Conrad passou a vazar 0,15 psi/min depois da 1ª EVA e 0,25 psi/min depois da 2ª, com limite de segurança de 0,30 psi/min. [Gaier, NASA/TM-2005-213610](https://ntrs.nasa.gov/api/citations/20050160460/downloads/20050160460.pdf)
- Abrasão: trajes da Apollo 12 gastos até o isolamento acima da bota após cerca de 8 h de superfície; mostradores riscados a ponto de ficarem ilegíveis na Apollo 16; luvas de proteção da Apollo 17 descartadas depois de duas EVAs. [Gaier, NASA/TM-2005-213610](https://ntrs.nasa.gov/api/citations/20050160460/downloads/20050160460.pdf)
- Entupimento: a poeira travou zíperes, travas de punho e de mangueira, viseiras e para-sóis, e os testes em solo subestimaram de forma consistente a gravidade do problema. [Gaier, resumo no NTRS](https://ntrs.nasa.gov/citations/20050160460)

### 4. A restrição de "walkback" nas travessias de LRV (Apollo 15–17)

- A bateria do LRV dava autonomia de 92 km, mas as tripulações nunca passaram do "Walkback Limit" de 7,6 km, a maior distância que um astronauta conseguiria voltar a pé se o veículo parasse. [NASA OCHMO-TB-023, p. 2](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf)
- Distância máxima real ao módulo lunar: 5,0 km (Apollo 15), 4,5 km (Apollo 16) e 7,6 km (Apollo 17). [NASA NSSDCA](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html)
- Planejamento da Apollo 15 (memorando Bellcomm, 13/10/1970): no começo da EVA manda o limite de "rideback" (falha de um PLSS: 0,95 h de oxigênio pelo B/SLSS com o LRV a 10 km/h em emergência); no fim manda o "walkback" (falha do LRV: consumíveis que restam para voltar a pé a 3,3 km/h, com 20% de margem metabólica). [Bellcomm B70 10028](https://apollojournals.org/alsj/19790073512_1979073512.pdf)
- Apollo 17: o limite de 7,6 km foi imposto como contingência contra a falha de um PLSS; para a volta a pé o plano assumia 3,6 km/h em retornos de menos de uma hora e 2,7 km/h nos mais longos. [ALSJ, Apollo 17, Station 2](https://apollojournals.org/alsj/a17/a17.sta2.html)
- Efeito na operação: a caminho da Estação 2 da Apollo 17, o ponto mais distante em que ainda sobrava tempo para geologia, Houston avisou que a chegada precisava ocorrer em cerca de 5 minutos para cumprir o walkback (142:39:55) [ALSJ, Camelot to Station 2](https://apollojournals.org/alsj/a17/a17.trvsta2.html); já na estação, Cernan disse que dava para cumprir os limites, mas não esticá-los (143:24:20) [ALSJ, Station 2](https://apollojournals.org/alsj/a17/a17.sta2.html).
- Hoje: o conceito de operações de EVA da NASA mantém a regra (rover não pressurizado a menos de 5 h de caminhada do módulo, cerca de 10 km a 2 km/h, sem contar rampas e obstáculos) e registra que os raios de walkback para Marte ainda são trabalho futuro. [NASA EVA-EXP-0042 Rev. B, 19/10/2020](https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf)

### 5. Como funcionava o relé de rádio do LRV (LCRU) e o que acontecia fora da visada do módulo lunar

- O LCRU era o elo principal entre os astronautas e a rede de solo (MSFN): a voz ia por VHF AM entre os trajes e o LCRU e por banda S direto entre o LCRU e a Terra (descida em 2265,5 MHz, subida em 2101,8 MHz), sem depender do módulo lunar. [LCRU Crew Training Manual, 30/03/1971](https://apollojournals.org/alsj/HSI-481184-LCRU.pdf)
- Em movimento usava a antena de baixo ganho apontada à mão para a Terra (a voz degrada rápido fora de ±30°) e não transmitia TV; parado usava a antena de alto ganho, que precisava ficar a ±2,5° da Terra para a TV. [LCRU Crew Training Manual](https://apollojournals.org/alsj/HSI-481184-LCRU.pdf)
- O alcance VHF entre astronauta e LCRU era de pelo menos 500 m (800 m possíveis), e o manual manda avaliar antes do voo as saídas com obstáculos grandes ou crateras no caminho do sinal. [LCRU Crew Training Manual](https://apollojournals.org/alsj/HSI-481184-LCRU.pdf)
- A bateria do LCRU dava pelo menos 6 h de voz e dados, ou 4 h de voz, dados e TV. [LCRU Crew Training Manual](https://apollojournals.org/alsj/HSI-481184-LCRU.pdf)
- Na prática (Apollo 17, EVA-2), longe do módulo lunar a comunicação seguia direto para a Terra, mas a voz caía de tempos em tempos porque Cernan não tinha mão livre para reapontar a antena enquanto dirigia (141:57:58, 141:58:52, 142:08:30); a nota do diário diz que, se a Terra ficasse atrás do maciço, a comunicação teria de passar pelo módulo lunar, com perda considerável de qualidade. [ALSJ, Camelot to Station 2](https://apollojournals.org/alsj/a17/a17.trvsta2.html)
- Fonte primária que descreva perda de sinal por falta de visada ao módulo lunar (missões sem LCRU, ou o modo de reserva via LM): não encontrado.

---

## B. Amostragem

### 6. Perfurações e coletas do Curiosity que falharam ou foram abortadas

Marcação: **[NA REGIÃO]** = dentro do intervalo de sols ~2300–4900; **[fora]** = antes disso.

- **[fora]** "Precipice" (baixo Monte Sharp), 30/11/2016, sol 1536: o mecanismo de avanço da broca travou logo depois de soltar o freio, e a perfuração só voltou no sol 2057, 521 sols depois, com a broca avançada pelo braço [NTRS 20230005798](https://ntrs.nasa.gov/citations/20230005798); na crista Vera Rubin (2018), duas tentativas seguidas pararam em rocha dura demais antes do furo "Stoer" (09/08/2018), e o JPL registra que não há como saber a dureza de uma rocha antes de furar [JPL, 2018](https://jpl.nasa.gov/news/news.php?feature=7230).
- **[NA REGIÃO]** "Aberlady" (Glen Torridon), 06/04/2019, sol 2370: a rocha se moveu quando a broca foi retirada [JPL, PIA23138](https://www.jpl.nasa.gov/images/pia23138-curiositys-first-clay-unit-drill-hole/); o bloco fraturou e a amostra não bastou para todos os experimentos, o que levou a um segundo furo [Bennett et al. 2022, JGR Planets](https://ntrs.nasa.gov/api/citations/20230001618/downloads/JGR%20Planets%20-%202022%20-%20Bennett%20-%20The%20Curiosity%20Rover%20s%20Exploration%20of%20.pdf).
- **[NA REGIÃO]** "Marker Band" (dez/2022 a fev/2023), quatro tentativas sem amostra: Amapari entrou só 7 mm na rocha dura [blog, sols 3677–3679](https://science.nasa.gov/blog/sols-3677-3679-lets-try-that-again-amapari/); a segunda parou sozinha antes da profundidade [blog, sols 3682–3683](https://science.nasa.gov/blog/sols-3682-3683-perspective/); Encanto não chegou à profundidade de amostragem [blog, sol 3721](https://science.nasa.gov/blog/sol-3721-wrapping-up-at-the-encanto-drill-site/); Dinira (sol 3742) fez só um mini-furo e a equipe seguiu viagem [blog, sols 3744–3745](https://science.nasa.gov/blog/sols-3744-3745-the-one-that-got-away/).
- **[NA REGIÃO]** "Mineral King" (março/2024; a página cita o depósito de Gediz Vallis nas proximidades): o furo do sol 4107 ficou raso e a amostra deu para o CheMin, não para o SAM [blog, sols 4125–4126](https://science.nasa.gov/missions/mars-science-laboratory/sols-4125-4126-woohoo-were-go-for-drilling-at-mineral-king-3/); Mineral King 2 foi reprovado no teste de pré-carga por estar perto demais do rover [blog, sols 4120–4122](https://science.nasa.gov/blog/sols-4120-4122-mars-throws-us-a-curveball/); Mineral King 3 não atingiu profundidade útil e o rover foi embora [blog, sols 4127–4130](https://science.nasa.gov/blog/sols-4127-4130-backstage-quick-change/).
- **[NA REGIÃO pelo intervalo de sols; a página não cita o local]** "Mammoth Lakes", sols 4214–4215 (12/06/2024): o teste de pré-carga, que verifica se a rocha é estável o bastante, falhou, e a perfuração foi retirada do plano. [blog, sols 4214–4215](https://science.nasa.gov/blog/sols-4214-4215-the-best-laid-plans/)
- **[NA REGIÃO pelo intervalo de sols; primeiro sulfato em camadas depois do terreno boxwork]** "Atacama", 25/04/2026: o furo foi feito, mas o bloco estava solto (cerca de 13 kg) e saiu do chão preso à broca; só se soltou em 01/05/2026 [NASA Photojournal](https://science.nasa.gov/photojournal/nasas-curiosity-rover-frees-its-drill-from-a-rock/) e o pó coletado se perdeu [blog, sols 4879–4885](https://science.nasa.gov/blog/curiosity-blog-sols-4879-4885-struggle-at-atacama/); a equipe refez o furo em "Campo Marte" com 28 mm, em vez dos 35 mm usuais [blog, sols 4900–4907](https://science.nasa.gov/blog/curiosity-blog-sols-4900-4907-pasadena-we-have-a-drill-sample/).

### 7. Alvos da região que a missão quis alcançar ou amostrar e não conseguiu

Ver também o item 6: a Marker Band foi deixada sem amostra depois de quatro tentativas.

- Travessia do pedimento Greenheugh (março/2022): a equipe queria cruzar cerca de 1,5 km do pedimento para fotografar a crista de Gediz Vallis e desistiu por causa do terreno "gator-back". [JPL, 07/04/2022](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reroutes-away-from-gator-back-rocks/)
- Crista de Gediz Vallis: três tentativas em três anos falharam (rochas "gator-back" e rampas íngremes demais) até a chegada em 14/08/2023; as rochas vindas do alto do Monte Sharp são, nas palavras do cientista do projeto, de lugares que o Curiosity nunca poderá visitar. [JPL, 18/09/2023](https://www.jpl.nasa.gov/news/nasas-curiosity-reaches-mars-ridge-where-water-left-debris-pileup/)
- Subida rumo a "Jau" (maio e junho de 2023): uma rampa de 23° com areia escorregadia e rochas do tamanho das rodas causou paradas por falha em vários percursos; a saída foi um desvio lateral de cerca de 150 m, que custou algumas semanas. [JPL, 2023](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-faces-its-toughest-climb-yet-on-mars/)
- Areia: em 2020 o rover fez um desvio de cerca de 1,6 km para contornar um grande campo de areia e não atolar [NASA/JPL, 2020](https://www.nasa.gov/centers-and-facilities/jpl/curiosity-mars-rovers-summer-road-trip-has-begun/?site=msl); em agosto de 2022 levou mais de um mês para cruzar o passo arenoso Paraitepuy, onde os morros ainda limitavam para onde as antenas podiam apontar [JPL, 2022](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reaches-long-awaited-salty-region/).
- Limites de hardware: com os freios do braço desgastados, a equipe concluiu que algumas rochas mais duras exigiriam martelamento demais para serem furadas com segurança, e o braço não é aberto quando o rover não está estável nas seis rodas. [JPL, 2022](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reaches-long-awaited-salty-region/)
- Terreno boxwork: os topos das cristas (1 a 2 m de altura) são pouco mais largos que o rover e nas depressões arenosas as rodas escorregam [NASA/JPL, 23/02/2026](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-rover-sees-martian-spiderwebs-up-close/); sair de uma depressão exigiu inclinações acima de 20°, onde o rover escorrega muito, e em vários pontos não havia rocha grande ou lisa o bastante para escovar [blog, sols 4641–4648](https://science.nasa.gov/blog/curiosity-blog-sols-4641-4648-thinking-outside-and-inside-the-boxwork/).

---

## C. Números do ambiente na cratera Gale

### 8. Taxa de dose de radiação na superfície (RAD) e efeito de um evento de partículas solares

- Valor típico: cerca de 210 microgray por dia (0,21 mGy/dia) na superfície, quase tudo de raios cósmicos galácticos, nos primeiros 10 meses (agosto de 2012 a junho de 2013). [NASA Science](https://science.nasa.gov/resource/radiation-measurements-on-mars/)
- Em dose equivalente: média de 0,67 mSv/dia no mesmo período, que não teve nenhuma tempestade solar forte [NASA, 2013](https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/); na viagem até Marte, dentro da nave, a média foi 1,8 mSv/dia [SwRI](https://www.swri.org/newsroom/press-releases/swri-scientists-publish-first-radiation-measurements-the-surface-of-mars).
- O artigo original (Hassler et al., Science) dá 0,210 ± 0,040 mGy/dia e, na tabela, 0,64 ± 0,12 mSv/dia (não conferido na página). [Science, PDF](https://www.science.org/cms/asset/b9057f23-375b-447a-ba62-65a4e7f691a4/pap.pdf)
- Evento solar de 11/09/2017: os níveis na superfície passaram do dobro de qualquer medida anterior do RAD e ficaram altos por mais de dois dias; o responsável pelo RAD disse que um astronauta em caminhada deveria se abrigar. [JPL, 2017](https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/)
- Evento solar de 20/05/2024: maior pico medido pelo RAD desde o pouso; um astronauta ao lado do rover teria recebido 8.100 microgray (cerca de 30 radiografias de tórax), e paredões ou tubos de lava dariam blindagem extra. [JPL, 10/06/2024](https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/)
- Abrigo natural medido: encostado num paredão em Murray Buttes (9 a 21/09/2016), o RAD registrou queda de 4% na radiação total e de 7,5% na de partículas neutras. [JPL](https://www.jpl.nasa.gov/news/how-nasas-curiosity-rover-is-making-mars-safer-for-astronauts/)

### 9. Temperatura do ar e do solo e vento medidos pelo REMS

- Sol típico no início da missão: ar de −2 °C a −75 °C e solo de 3 °C a −91 °C. [JPL, 21/08/2012](https://www.jpl.nasa.gov/news/nasas-curiosity-studies-mars-surroundings-nears-drive/)
- Em dois anos marcianos de medidas, o ar foi de 15,9 °C (tarde de verão) a −100 °C (noite de inverno). [JPL, 2016](https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/)
- Pouco antes da tempestade de 2018: ar entre 276 K e 202 K (≈ 3 °C e −71 °C) e solo entre 286 K e 187 K (≈ 13 °C e −86 °C), com amplitude diária de ~71 K no ar e ~94 K no solo (conversões para °C nossas). [Viúdez-Moreiras et al. 2019, JGR Planets](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- Vento: o sensor de vento do REMS foi danificado no pouso, funcionou só em parte até o sol 1491 e então parou, de modo que não há medida direta de vento depois disso. [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- Velocidades: a análise de mais de um ano marciano e meio de dados do REMS indica ventos de encosta noturnos de até cerca de 21 m/s e máximo diurno de cerca de 14 m/s (a página grafa "mks"). [Ullán et al. 2017, Icarus, resumo no CAB](https://cab.inta-csic.es/en/publicaciones/analysis-of-wind-induced-dynamic-pressure-fluctuations-during-one-and-a-half-martian-years-at-gale-crater/)
- Visibilidade: de cerca de 30 km no verão, mais empoeirado, a 130 km no inverno. [JPL, 2016](https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/)

### 10. Tempestade global de poeira de 2018 em Gale

- A tempestade chegou a Gale no sol 2075 (início de junho de 2018); a opacidade (tau, Mastcam em 880 nm) saiu de ~0,7 e chegou a ~8,5 no sol 2085, voltando aos valores normais por volta do sol 2157. [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- Na época o JPL informou tau acima de 8,0, o maior da missão, com névoa seis a oito vezes mais espessa que o normal para a estação (sobre o Opportunity, tau perto de 11). [JPL, 20/06/2018](https://www.jpl.nasa.gov/news/martian-dust-storm-grows-global-curiosity-captures-photos-of-thickening-haze/)
- O máximo diário de radiação UV caiu 90% entre os sols 2075 e 2085. [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- A amplitude térmica diária encolheu de ~71 K para ~36 K no ar e de ~94 K para ~38 K no solo. [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)
- Efeito no Curiosity: por ter gerador nuclear, seguiu operando dia e noite; a Mastcam precisou de exposições mais longas e os engenheiros viram pouco risco para os instrumentos. [JPL, 20/06/2018](https://www.jpl.nasa.gov/news/martian-dust-storm-grows-global-curiosity-captures-photos-of-thickening-haze/)
- Não se detectou nenhum redemoinho de poeira (dust devil) entre os sols 2083 e 2107. [Viúdez-Moreiras et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6750032/)

---

## D. Trajes espaciais

### 11. Duração de EVA de projeto: xEMU / AxEMU e Apollo A7LB

- Traje lunar da NASA (xEVA/xEMU): EVAs de até 8 horas (6 ± 2 h), com no mínimo 8 h de consumíveis primários mais 1 h de contingência. [NASA EVA-EXP-0042 Rev. B, 19/10/2020](https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf)
- Um artigo de 2026 do NASA Johnson confirma o xEMU projetado para 8 horas de operação autônoma e até 100 EVAs por missão. [ICES-2026-126](https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf)
- Axiom AxEMU (Artemis III): caminhadas de pelo menos oito horas, e pelo menos duas horas no frio das regiões permanentemente sombreadas. [Axiom Space, 16/10/2024](https://www.axiomspace.com/release/axiom-space-prada-unveil-spacesuit-design-for-moon-return)
- Apollo 15–17 (traje A7LB): a vida operacional do PLSS foi dobrada de 4 h (Apollo 11–14) para 8 h [ALSJ, PLSS](https://apollojournals.org/alsj/plss.html); o artigo da NASA de 2026 fala em EVAs de até 7 h [ICES-2026-126](https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf) e o planejamento da Apollo 15 contava com bateria do PLSS para 7 h [Bellcomm B70 10028](https://apollojournals.org/alsj/19790073512_1979073512.pdf).
- Reserva de emergência Apollo: o OPS dava cerca de 30 minutos de oxigênio, ou 75 a 90 minutos quando combinado com o BSLSS. [ALSJ, PLSS](https://apollojournals.org/alsj/plss.html)
- Traje de Marte: ainda sem duração fixada; o estudo do PLSS marciano avaliou EVAs de 2, 4, 6 e 8 horas e admite encurtar a EVA ou restringir a distância ao habitat para caber na meta de massa. [ICES-2026-126](https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf)

---

## O que isso muda no protótipo

São regras que o planejador de rotas ou os protocolos de segurança poderiam adotar. Os números citados têm fonte nos itens indicados; os limiares sem fonte ficam como decisão da equipe.

- **Raio de retorno como restrição dura (itens 4 e 11).** Cada ponto da rota precisa caber em dois limites recalculados ao longo da EVA: volta de veículo com um traje em falha (domina no início) e volta a pé com o veículo em falha (domina no fim). Referências: 7,6 km na Apollo; menos de 5 h de caminhada a 2 km/h (~10 km) no conceito atual da NASA, a reduzir por rampa e obstáculo; EVA de até 8 h com 1 h de reserva. Para Marte a NASA ainda não definiu o raio, então o valor do protótipo deve aparecer como premissa nossa.
- **Classe de terreno "areia solta, crosta ou ripple" proibida por padrão (itens 1 e 7).** Spirit e Opportunity atolaram em areia que não parecia perigosa vista de cima, e o Curiosity preferiu um desvio de 1,6 km a cruzar um campo de areia. O planejador deve contornar e, se cruzar for inevitável, exigir checagem de escorregamento a cada trecho curto.
- **Custo de rampa combinado com areia (item 7).** Acima de 20° em areia o rover escorrega muito, e 23° com areia e blocos gerou falhas até um desvio lateral de 150 m resolver. O custo da rota deve crescer com inclinação e tipo de solo juntos, e o planejador deve oferecer o desvio lateral antes de insistir na subida. O Curiosity chegou a 31° de inclinação ao subir o pedimento e tolera 45° sem tombar, mas as rodas patinam em rampa íngreme. [JPL, 2020](https://jpl.nasa.gov/news/news.php?feature=7617)
- **Classe "capa de arenito com ventifactos (gator-back)" a evitar (item 2).** O topo do pedimento Greenheugh é transponível, mas lento e destrutivo para rodas. Tratar como zona de alto custo que só entra na rota com justificativa explícita.
- **Sombra de comunicação no mapa (item 5).** Marcar os trechos em que o relevo esconde o relé ou a Terra, manter quem está a pé a até 500 m do veículo-relé (alcance VHF do LCRU) e exigir contato antes de entrar num trecho sem visada.
- **Regra de abrigo contra radiação (item 8).** A dose de fundo é ~0,21 mGy/dia, mas um evento solar pode mais que dobrar o nível por dias, e o maior já medido daria 8.100 microgray a quem estivesse ao lado do rover. Cada trecho da rota deveria ter um paredão ou butte catalogado como abrigo, com o tempo até ele visível na interface. O ganho medido ao pé de um paredão foi de só 4% para a radiação de fundo, então o abrigo vale como medida para evento solar, não como proteção contínua.
- **Poeira e frio como entradas do planejamento (itens 9 e 10).** Em 2018 o tau subiu de ~1 para ~8,5 em 10 sols (sols 2075 a 2085), cortando 90% do UV. O protocolo pode encolher o raio permitido quando o tau sobe e manter as EVAs na janela diurna, já que o solo chega a cerca de −86 °C a −91 °C à noite.
- **Amostragem com plano B e protocolo de poeira (itens 6 e 3).** Na região, as falhas de coleta vieram de rocha dura demais, bloco solto e alvo instável. Toda parada de amostragem deveria ter alvo alternativo e teste de estabilidade antes de furar. Do lado Apollo, a poeira levou o vazamento de um traje de 0 a 0,25 psi/min em duas EVAs, contra limite de 0,30, o que justifica checagem de vedação depois de cada saída e proteção contra poeira levantada pelas rodas como item de aborto.
