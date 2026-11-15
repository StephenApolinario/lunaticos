# lunaticos

Projeto da equipe para o **NASA Space Apps Challenge 2026**, desafio
[Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

- Dificuldade: intermediária
- Temas: Human Exploration, Mars, Planets & Moons, Software, Space Exploration
- Página consultada em 14/11/2026. A NASA avisa que pode adicionar recursos antes do hackathon, então vale reconferir a aba Resources.

## O desafio

Criar uma visão **integrada e em camadas** de um local ou de uma rota na superfície de Marte, juntando dados de várias missões científicas da NASA, para ajudar um explorador humano a planejar e executar uma caminhada em Marte ("Marswalk") com segurança, fazendo ciência nova pelo caminho.

O problema de fundo: os dados de Marte existem, mas não estão combinados do jeito que uma missão humana específica precisa. Ferramentas como o Mars Trek e o mapeamento geológico USGS-NASA são feitas para visões regionais e globais, não para a área hiperlocal de uma única saída de superfície. É nesse recorte hiperlocal que a nossa entrega tem que funcionar.

## O que a entrega precisa cobrir

- Um mapa, ferramenta ou interface que um astronauta usaria durante uma missão de exploração de superfície, feito com dados e ferramentas da NASA.
- Um **objetivo científico** e um **local** que combinem. Exemplo da própria NASA: estudar formações "boxwork" na região do Monte Sharp, que o Curiosity observou em 2025.
- **Pelo menos três tipos de dado** em camadas ou combinados: óptico, térmico, espectral, topográfico, geofísico, atmosférico, radiação, químico.
- **Segurança do astronauta em primeiro lugar.** O ambiente de radiação de Marte é diferente do da Terra, da órbita e da Lua, então dados de clima espacial contam.
- **Mobilidade real.** O astronauta está de traje e carregando equipamento. Se possível, um mapa de rota que cumpra os objetivos científicos desviando de obstáculos grandes, como formações rochosas.

O local pode ser um já bem explorado por rovers (mais dados e imagens) ou um pouco estudado (mais difícil).

## Considerações opcionais

- Formato: tela no habitat ou na nave para planejar a rota, app de tablet levado na saída, HUD no visor do capacete, ou outro.
- Tipo de produto: retrato estático, produto interativo, ou sistema que gera mapas de locais e dados diferentes.
- Recorte de tempo: dados de um período passado, previsão para um período futuro, ou nenhum (para dados estáveis como topografia e geologia).
- Imagens em ponto de vista das missões de superfície, para o astronauta saber o que esperar ao chegar.
- Apoio de rovers ou robôs no transporte, ou astronautas trabalhando em dupla.
- Inspiração em mapas de outras missões da NASA (Terra, Lua, outros planetas, exoplanetas).

## Recursos da NASA

| Recurso | Para que serve |
|---|---|
| [JPL Mars Trek](https://trek.nasa.gov/mars/) | Portal web com dados da NASA em vários locais de pouso |
| [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) | Mapa geológico padronizado de Marte |
| [Rota proposta do Curiosity no Monte Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) | Exemplo visual de mapa de rota |
| [Galeria de imagens brutas do Perseverance](https://mars.nasa.gov/mars2020/multimedia/raw-images/) | Mais de 1 milhão de imagens da superfície |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) | Referência de visualização em camadas (dados da Terra) |

A NASA não endossa sites fora do governo dos EUA. Ao usar dados de terceiros, seguir os termos de uso de cada site.

## Protótipo

A pasta `prototipo/` tem um protótipo em Three.js para validar a ideia de duas telas sobre a mesma rota: o mapa de planejamento (tablet) e o visor do capacete. Ele usa a travessia do Monte Sharp como exemplo. Não tem build; basta servir a pasta:

```bash
python3 prototipo/tools/servir.py
```

Depois abrir http://localhost:5183. A entrada é a página de apresentação do projeto (`prototipo/index.html`, com o estilo e as imagens em `prototipo/apresentacao/`); o botão "Ver demo" abre o protótipo, que fica em http://localhost:5183/demo.html. As imagens da apresentação são capturas do próprio protótipo. Para conferir a matemática de projeção, rotas e relevo:

```bash
node prototipo/src/check.mjs
```

A IA de bordo roda na nuvem, pelo [OpenRouter](https://openrouter.ai), com o modelo `openai/gpt-6-luna`. Ela precisa de internet e de uma chave com crédito no arquivo `.env` da raiz do repositório, que não entra no git:

```bash
cp .env.example .env
```

Depois preencha `OPENROUTER_API_KEY` no `.env` e reinicie o servidor. A chave fica no servidor do protótipo e nunca vai para a página.

Sem chave, a IA usa o [Ollama](https://ollama.com) aberto neste computador, sem internet, com o modelo baixado uma vez (9,3 GB; ocupa cerca de 10 GB de memória enquanto está carregado):

```bash
ollama pull qwen3:14b
```

A voz neural e a escuta por voz são opcionais. O comando abaixo instala o que falta (cerca de 1,1 GB dentro de `prototipo/tools/voz/`, contando o modelo de escuta que o servidor baixa na primeira vez) e sobe o servidor de voz em http://127.0.0.1:5184:

```bash
prototipo/tools/voz/servir-voz.sh
```

Para testar a IA com perguntas reais sobre uma saída montada com o relevo e as medições de verdade:

```bash
node prototipo/tools/testar-ia.mjs --nuvem
```

Com `--nuvem` o teste usa o modelo da nuvem pelo servidor do protótipo, que precisa estar no ar; sem a opção, usa o modelo local.

### Publicar na Vercel

O site publicado é a pasta `prototipo/` (arquivos estáticos, sem etapa de build: a apresentação na entrada e o protótipo em `/demo.html`) mais duas funções em `prototipo/api/`, que fazem na Vercel o papel do `servir.py`: `/ia/saude` e `/ia/chat`. No projeto da Vercel, a pasta raiz (Root Directory) é `prototipo`; o `vercel.json` de lá liga os endereços `/ia/...` às funções.

- A chave da IA fica em Settings → Environment Variables do projeto, como `OPENROUTER_API_KEY`. Depois de criar ou trocar a variável é preciso publicar de novo. Sem ela o mapa e o visor funcionam e a IA aparece fora do ar.
- A IA só aceita pedidos vindos da própria página, com no máximo 60 chamadas por visitante a cada 5 minutos (valor escolhido pela equipe). Essa contagem fica na memória da função, então é aproximada; para um limite exato dá para criar uma regra de rate limit no firewall do projeto, no painel da Vercel. O teto em dinheiro fica na própria chave, no OpenRouter.
- A fala e a escuta do site publicado vêm de mais três funções (`/voz/saude`, `/voz/falar` e `/voz/ouvir`, em `prototipo/api/_voz.mjs`), com a mesma chave e pelo OpenRouter: a fala é do Kokoro-82M com a mesma voz do servidor local (`pf_dora`) e a escuta é do Whisper large v3. O texto a falar e o áudio da pergunta saem do navegador para o servidor do site. A página não procura nada no computador de quem visita.

Para conferir a ponte da IA sem rede:

```bash
node prototipo/api/_check.mjs
```

### Publicar num servidor próprio

O `Dockerfile` da raiz monta o protótipo para rodar fora deste computador: a página e a ponte da IA de bordo, só com a biblioteca padrão do Python. A voz neural e a escuta locais não vão junto; publicada, a página usa a voz e a escuta do navegador e não procura nada no computador de quem visita.

```bash
docker build -t lunaticos .
```

```bash
docker run --rm -p 5183:5183 --env-file .env -e SITE_ORIGINS=https://endereco-publico lunaticos
```

- `OPENROUTER_API_KEY`: a chave da IA, guardada como segredo no servidor. Sem ela o mapa e o visor funcionam e a IA aparece fora do ar.
- `SITE_ORIGINS`: o endereço público da página (mais de um, separados por vírgula). A IA só aceita pedidos vindos dele.
- Quem tem o endereço usa o crédito da chave. O servidor segura o abuso com 60 chamadas por visitante a cada 5 minutos e 1500 por dia (valores escolhidos pela equipe, em `prototipo/tools/servir.py`); o teto em dinheiro fica na própria chave, no OpenRouter.

Para conferir essas proteções:

```bash
python3 prototipo/tools/check_servir.py
```

O que ele faz hoje:

- **Tablet:** mapa 3D com relevo e imagem reais, camadas (declive, volta a pé, rádio, radiação, térmico), a travessia do Monte Sharp com as paradas científicas e o painel "Segurança da saída". A página tem a moldura de um tablet de missão, com uma barra de estado (lugar, estação de hoje em Marte e hora de partida); a moldura é só aparência.
- **Marte inteiro:** o tablet abre num globo de Marte em 3D (mosaico global do Viking, lido do NASA Mars Trek), com tudo escurecido menos a área mapeada. Aproximar o zoom sobre ela entra no mapa de planejamento, sem clique; afastar o zoom até o limite volta ao planeta. No resto do planeta o zoom para a 250 km de altitude, onde a imagem de 232 m por pixel ainda mostra o relevo. Com `?local` no endereço (`demo.html?local`) o tablet abre direto na área mapeada. No mapa de planejamento, o bloco de relevo fica apoiado no chão real da região (o mesmo mosaico do Viking, mais escuro e sem relevo), com o céu no horizonte.
- **Qualidade da imagem:** três níveis, escolhidos no tablet e guardados no navegador. **Mínima** (padrão): foto de 2,5 m, sem sombra projetada nem imagem fina, para rodar em qualquer computador. **Média**: foto de 0,7 m já pronta (nítida de longe, sem buscar nada na rede) e sombras do relevo. **Alta**: o mesmo, com sombras suaves e, de perto, a imagem de 25 cm lida da rede; pesa em placas de vídeo modestas. No tablet parado a cena só é redesenhada quando algo muda.
- **Imagem de perto** (qualidade alta): ao aproximar, o mapa busca na rede a imagem de 25 cm por pixel (ortofoto do USGS) só para a região em foco. Sem rede, fica a foto de 0,7 m.
- **Rota livre:** cada clique no mapa vira a próxima parada (A, B, C… até 13). A rota sai do habitat, passa por todas na ordem e volta, calculada na hora sobre o relevo real, a pé ou de veículo, sempre pelo caminho mais seguro (foge das encostas e evita onde não há rádio).
- **Hora do dia:** um controle de hora move o Sol (posição calculada pelo algoritmo Mars24 da NASA para a estação de hoje em Marte), refaz as sombras do relevo e diz quanta luz sobra para a saída. O relógio do visor parte da hora escolhida.
- **Frio:** o tablet avisa no planejamento em que parte da saída o ar estimado fica abaixo do mínimo do traje e para quando mudar a partida. No visor, o aviso "Frio chegando" aparece uma hora antes, e no frio o aquecimento gasta mais bateria. O mínimo do traje (−60 °C), a antecedência e o gasto extra são hipóteses da equipe.
- **Medições do Curiosity:** temperatura e pressão do REMS na estação atual, dose de radiação do RAD nos últimos 30 dias e fotos da Navcam em cada parada, lidas dos serviços públicos da NASA quando o protótipo abre.
- **Segurança:** até onde o oxigênio cobre a volta a pé, onde a rota perde o rádio direto com o habitat, o abrigo no ponto mais afastado e o protocolo de cada cenário de perigo.
- **Onde a coleta do rover deu trabalho:** sete perfurações do Curiosity na região que falharam ou ficaram incompletas na primeira tentativa (em quatro delas a missão conseguiu amostra depois, ali perto), cada uma com a fonte e um botão que acrescenta o local à rota.
- **Visor do capacete:** um visor único e enxuto, com a vista do terreno livre. Ficam sempre na tela a linha da saída (tempo, hora local e modo), o rumo e a próxima parada, três blocos (O₂, bateria e volta a pé), uma barra com o estado de segurança e a frase da IA, e o minimapa. O resto abre a pedido, em três folhas: próxima parada e terreno à frente (com o perfil), traje e ambiente, volta a pé e abrigo. Alertas por gravidade e o protocolo de emergência, conduzido passo a passo, aparecem sozinhos no alto e não saem; um quarto bloco mostra a leitura que explica o alerta. Há ainda a guia no chão, a ciência nas paradas, o diário de amostras e o relato de perigos. Os controles da simulação ficam numa barra fina embaixo. Volta-se ao tablet pelo botão "Voltar ao tablet" ou tocando no minimapa, que abre o mapa já centrado no astronauta. Com uma saída em andamento, o mapa do tablet mostra uma bolinha, sem texto, no ponto em que o astronauta está (posição simulada). Abrir o tablet e voltar retoma a saída de onde parou (posição, relógio, diário e conversa); mudar o plano no tablet começa uma saída nova e tira o pino. Ele nasceu da junção de três variantes, que continuam em `prototipo/visores/` (ver `prototipo/visores/LEIA-ME.md`).
- **IA de bordo:** no visor e no tablet, a conversa é com um modelo de linguagem que faz o papel do computador de bordo. Na tela ele aparece só como "IA de bordo"; como o modelo é servido está nas instruções acima. A cada pergunta ele recebe os dados da saída daquele instante e pode chamar ferramentas (plano, paradas, protocolos, busca nas fontes, calculadora) e ações (registrar amostra, relatar perigo, conduzir protocolo; no tablet, mudar hora, modo, pontos da rota e camada). Só pode citar número que veio dos dados: a resposta é conferida antes de aparecer. Recusa assunto fora da missão. Os alertas e os protocolos não dependem dela.
- **Perguntas do tipo "e se":** a IA simula o mesmo plano a pé ou de veículo, com as paradas de coleta (distância, duração, oxigênio, trechos em que o veículo não passa), diz quanto tempo dá para ficar parado sem perder a volta e aponta o ponto mais próximo da rota que serve para descansar (chão plano, rádio com o habitat, fora das rochas cortantes). Ela entende palavra trocada pelo reconhecimento de voz ("hover" por rover, "jipe" por veículo).
- **Rover Curiosity no mapa:** um pino R marca onde o rover está, pela posição que a NASA publica (lida quando o protótipo abre). A IA diz a distância até ele e monta uma rota até lá a pedido.
- **Veículo no visor:** escolhendo "Veículo" no tablet, o visor mostra a saída de dentro de um buggy aberto de dois lugares (modelo ilustrativo, na linha do jipe lunar). Nas paradas de coleta o astronauta desce e o veículo fica estacionado ao lado.
- **Voz e escuta:** o assistente fala com uma voz neural local (Kokoro-82M, português do Brasil) quando o servidor de voz está ligado; sem ele, usa a voz do sistema, que soa robótica. O botão Falar grava a pergunta e o mesmo servidor a transcreve neste computador (Whisper), em qualquer navegador. No site publicado a fala e a escuta vêm do próprio site, com a mesma voz. Apertar Falar corta o que a IA estiver dizendo, e com o microfone aberto ela só fala alerta de perigo, emergência e passo de protocolo.
- **Visor comandado pela IA:** pedidos como "me mostra meu oxigênio", "coloca na tela a velocidade média" ou "tira o mapa" fixam ou tiram leituras do visor e ligam ou desligam painéis. Leitura que já está na tela não ganha cartão repetido: a peça que existe pisca e a IA diz onde ela fica. Os blocos de O₂, bateria e volta a pé saem a pedido e voltam sozinhos em qualquer alerta (decisão da equipe). Alertas e protocolos não saem da tela. A pedido, ela também pinta sobre o terreno do visor uma camada do mapa (térmico noturno, declive, rádio, radiação, volta a pé ou areia).
- **Areia fofa:** a camada Areia marca a areia escura estimada pela cor da imagem HiRISE e pelo declive (não é mapa da NASA). As rotas livres preferem outro caminho, o painel de segurança diz quantos metros da rota passam por ela e a IA avisa quando há areia à frente. A travessia pronta ainda cruza 2,2 km dessa areia.

A pesquisa que sustenta os protocolos e as lições de missões passadas está em [docs/pesquisa.md](docs/pesquisa.md), com link em cada fato.

De onde vem cada informação está em [docs/fontes.md](docs/fontes.md), item por item, com o tipo (dado de sonda ou rover, cálculo sobre dado real, estimativa, hipótese da equipe, simulado ou ilustrativo) e o link. A mesma lista aparece no fim do painel do tablet e numa página com filtro por tipo de dado, [Fontes do Martian Map](https://claude.ai/artifact/F5u8sQ8ddFkvBahT6FrXXn) (artifact privado: só abre para quem recebeu acesso). Em resumo:

- **Dado de sonda ou rover:** relevo (DEM do USGS), imagens HiRISE (2,5 m, 64 cm e 25 cm), imagem térmica THEMIS, unidade geológica (USGS), trajeto do Curiosity, temperatura e pressão (REMS), radiação (RAD) e fotos da Navcam.
- **Fato publicado:** a ciência das paradas, os casos de coleta, a velocidade a pé de planejamento da NASA (2 km/h), o tanque e a pressão do traje, e os números dos cenários de treino (vento mais forte, visibilidade na tempestade de 2018, frio recorde, evento solar de 2017).
- **Cálculo ou estimativa sobre esses dados:** posição do Sol e sombras, declive, rotas, volta a pé, rádio, abrigo de relevo, temperatura por hora, o efeito do relevo na radiação, o consumo e a reserva de oxigênio do traje.
- **Hipótese da equipe:** velocidade do veículo, tempo de parada, limites de declive, alturas das antenas, limites dos alertas, bateria do traje, a zona de 250 m em volta das rochas cortantes, os protocolos de emergência e as perguntas e tarefas das paradas.
- **Simulado:** a posição do astronauta no visor (ele anda sobre a rota; não há localização real) e as falhas de traje, rádio e veículo dos cenários de treino.

As rotas livres usam a função de caminhada de Tobler sobre a grade de 8 m; blocos menores que isso não aparecem, então elas servem para planejar e não substituem a leitura do terreno.

Os dados ficam em `prototipo/assets/` (cerca de 10 MB):

| Dado | Fonte |
|---|---|
| Relevo (`elevation/`, grade de 8 m) | [MSL Gale Merged DEM 1 m v3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m), Calef & Parker, USGS Astrogeology / JPL-Caltech / NASA |
| Imagem (`hirise/`) | HiRISE colorida (MRO), mosaico da equipe MSL, NASA/JPL-Caltech/UArizona |
| Declive (`slope.png`) | Classes de declive calculadas sobre o mesmo DEM |
| Areia escura (`areia/`) | Estimativa da equipe sobre a imagem HiRISE e o DEM, feita por `prototipo/tools/gerar-areia.mjs` |

Lidos da rede, sem copiar para o repositório:

| Dado | Fonte |
|---|---|
| Imagem de 64 cm e térmico noturno | [NASA Mars Trek](https://trek.nasa.gov/mars/), camadas `curiosity_hirise_mosaic` (HiRISE) e `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` (THEMIS, Mars Odyssey) |
| Imagem de 25 cm | [MSL Gale Merged Orthophoto Mosaic 25 cm v3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm), USGS, lida por pedaços do arquivo de 24 GB |
| Temperatura e pressão | REMS (Curiosity), [feed público da NASA](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json) |
| Radiação | RAD (Curiosity), série [msl_rad_dosimetry](https://iswa.gsfc.nasa.gov/IswaSystemWebApp/hapi/info?id=msl_rad_dosimetry) do NASA CCMC |
| Posição atual do rover | [Where is Curiosity?](https://science.nasa.gov/mission/msl-curiosity/location-map/), arquivo de posição do mapa da NASA |
| Fotos nas paradas | Navcam do Curiosity, [imagens brutas da missão](https://mars.nasa.gov/msl/multimedia/raw-images/) |

O relevo é um recorte do DEM de 3,6 GB do USGS, lido direto do servidor. Para refazer o recorte (leva alguns minutos):

```bash
cd prototipo/tools && npm install && npm run extrair-dem
```

Para refazer a estimativa de areia escura (alguns segundos):

```bash
cd prototipo/tools && npm install && node gerar-areia.mjs
```

Se o arquivo de relevo faltar, o protótipo abre com um relevo aproximado e avisa no selo do mapa.

O protótipo não fecha nenhuma das decisões abaixo.

## Decisões em aberto

Nada abaixo foi decidido ainda.

- Objetivo científico da missão
- Local ou rota em Marte
- Quais camadas de dado entram (mínimo três tipos) e de quais missões
- Formato da entrega (habitat, tablet, HUD, outro)
- Stack técnica
