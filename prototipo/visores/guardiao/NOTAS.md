# Visor Guardião · notas

Variante de visor em que tudo na tela responde a uma pergunta: **"estou seguro, e se não estiver, o que faço agora?"**. Abrir com `http://localhost:5183/?visor=guardiao` e clicar em "Entrar no visor do capacete".

Verificação sem navegador (57 asserções sobre as rotas e o DEM reais):

```bash
node prototipo/visores/guardiao/check.mjs
```

## Mapa dos módulos

A lógica não importa nada da tela: nenhum módulo da primeira tabela usa DOM, e todos rodam no Node (é o que o `check.mjs` faz). Dá para levar a lógica para outro visor sem levar o HUD.

### Lógica pura (sem DOM)

| Arquivo | O que faz | Exporta | Depende de |
|---|---|---|---|
| `catalog.js` | Dados: níveis de alerta, limites, panes dos cenários, protocolos | `LEVELS`, `levelOrder`, `RULES`, `FAULTS`, `SHELTER_NAMES`, `SHELTER_PHRASES`, `SCENARIOS`, `PROTOCOLS` | `src/simulation.js`, `src/safety.js` (`ASSUMPTIONS`), `src/format.js` |
| `engine.js` | Estado da saída integrado no tempo: seguir o plano, parar, ir a um abrigo, sair da rota, cenários | `createState`, `patch`, `advance`, `jump`, `positionOf`, `mobility`, `ratesOf`, `effects`, `vehicleDistM`, `indexAt`, `o2PctOf`, `batteryPctOf`, `triggerScenario`, `clearScenario`, `applyPatch`, `release`, `NAV_PLAN`, `NAV_HOLD` | `catalog.js`, `src/route.js`, `src/simulation.js`, `data/travessia.js` |
| `analysis.js` | Volta a pé, ponto de não retorno, faixas da rota, abrigos e escolha do abrigo, rádio | `analyze`, `createAnalyzer` (cache), `pickShelter` | `engine.js`, `catalog.js` e o objeto `context.safety` recebido por parâmetro |
| `readout.js` | Leitura de um instante (tudo o que a tela e as regras consultam) e tendências | `buildReadout`, `updateTrends`, `EMPTY_TRENDS` | `engine.js`, `catalog.js`, `src/route.js` |
| `rules.js` | Motor de regras: condições de alerta, linha de estado, fala do assistente | `detect`, `statusLine`, `assistantMessage`, `shelterLine`, `goStepText`, `fmtWalk` | `catalog.js`, `src/format.js` |
| `alerts.js` | Gerente de alertas: prioridade, agravamento, reconhecimento, histórico | `createAlerts`, `syncAlerts`, `ackAlert`, `firstUnacked` | `catalog.js` |
| `protocols.js` | Motor de protocolos: passos, decisão, ida ao abrigo, visão pronta para a tela | `createProtocols`, `syncProtocols`, `stepsOf`, `conducting`, `hasPending`, `confirmStep`, `decide`, `protocolView` | `catalog.js`, `data/protocolos.js` |
| `session.js` | Junta tudo acima: um passo por quadro e as ações do usuário | `createSession`, `stepSession`, `setPaused`, `setSpeed`, `toggleScenario`, `clearScenarios`, `acknowledge`, `confirmCurrentStep`, `decideCurrent`, `scrubTo` | todos os módulos de lógica |

### Dependem do navegador

| Arquivo | O que faz | Exporta | Usa |
|---|---|---|---|
| `visor.js` | Entrada da variante (contrato do `LEIA-ME.md`): câmera, teclado, ponteiro, laço de quadros, marcas projetadas no terreno | `createVisor` | `document`, Three.js, `session.js`, `audio.js`, `hud.js` |
| `hud.js` | Monta a marcação e desenha um quadro escrevendo só o que mudou | `createHud` | DOM (`src/dom.js`), `ResizeObserver`, `panels.js` |
| `panels.js` | Pilha de alertas, protocolo, abrigos e histórico, com nós reaproveitados | `createAlertStack`, `createProtocolPanel`, `createShelterPanel`, `createHistoryPanel`, `levelIcon`, `setLevel`, `setData`, `setHidden` | DOM (`src/dom.js`) |
| `audio.js` | Tons por nível e voz do assistente, com preferência guardada | `createAudio` | Web Audio, `speechSynthesis`, `localStorage` |
| `visor.css` | Todo o estilo, com prefixo `guardiao-` | | variáveis de `styles.css` |

`check.mjs` é a verificação e não é carregado pelo visor.

### Como reaproveitar a lógica sem a tela

O ponto de entrada é `session.js`. Um visor que queira os alertas, os protocolos e a análise do Guardião com a própria tela faz isto:

```js
import { createAnalyzer } from './analysis.js';
import { createSession, stepSession, toggleScenario, acknowledge, confirmCurrentStep, decideCurrent } from './session.js';
import { protocolView } from './protocols.js';
import { statusLine, assistantMessage, goStepText } from './rules.js';

const analyzer = createAnalyzer(context.safety, context.terrain.isReal);
let session = createSession(plan);                                  // em start(plan)

session = stepSession(session, dtS, context.terrain, analyzer);     // em frame(dtS)
const { r, alerts, events, pos, ground } = session;                 // leitura, alertas, eventos do quadro, posição
const proto = protocolView(session.protocols, r, goStepText);       // protocolo em condução, ou null
const status = statusLine(r, alerts.active);                        // "seguro" ou o alerta mais grave
const fala = assistantMessage(r, alerts.active, proto);             // { key, priority, text }
```

Pontos de atenção para a junção:

- **O Guardião não usa `advance` nem `deriveReadout` de `src/simulation.js` para mover o astronauta.** Ele tem estado próprio (`engine.js`), porque precisa parar, voltar e sair da rota. `deriveReadout` só é chamado para aproveitar alvo, rumo, declive e zona de rochas. Um visor que continue no estado do visor base não vê as paradas e os desvios do Guardião.
- **A posição da câmera vem de `session.pos` e `r.heading`**, não de `samplePath`, porque o astronauta pode estar fora da rota.
- **Toda ação do usuário deve chamar `analyzer.invalidate()`** antes de mudar a sessão, senão a análise fica até 0,25 s atrasada (ver `apply` em `visor.js`).
- **`events`** traz o que aconteceu no quadro (`raised`, `escalated`, `cleared` para alertas; `started`, `closed`, `reopened`, `arrived` para protocolos). É por ele que o som é disparado.
- As sessões e os estados são objetos congelados: cada função devolve um novo.

## Estado de cada parte

| Parte | Estado | Como foi conferida |
|---|---|---|
| Motor, análise, regras, alertas, protocolos, sessão | pronta | `check.mjs` (57 asserções com rotas e DEM reais) e uso no navegador |
| Ponto de não retorno e volta a pé | pronta | igual a `plan.safety.noReturn` do tablet; tempo e O₂ previstos batem com os simulados |
| HUD, painéis e CSS | pronta | navegador em 1440×900 e 375×812, sem corte e sem rolagem |
| Câmera, teclado, marcas no terreno | pronta | navegador |
| Cenários solar, pane do veículo, vento e traje | prontos | `check.mjs` e navegador |
| Cenários poeira, frio, rádio e O₂ | lógica pronta, tela não percorrida | só `check.mjs` |
| Som e voz | pela metade | rodou sem erro com os dois ligados; a saída audível não foi ouvida |
| Abrigo no relevo | pela metade | funciona, mas a ida é em linha reta, sem desvio de obstáculo |
| Volta a pé animada | pela metade | segue a linha da rota com ritmo ajustado; o caminho real não é exposto pelo módulo compartilhado |
| Efeito físico de poeira, frio e vento | pela metade | poeira só escurece a vista e põe ruído no rádio; frio só gasta bateria; vento só gera o alerta |
| Passos dos protocolos | pela metade | texto próprio, diferente do de `data/protocolos.js` |
| Plano de destino livre (`plan.isCustom`) | não testado | o código só usa `plan.stops` |
| Testes da tela | não existem | `hud.js` e `panels.js` só foram conferidos à mão |

## Teclas

`Espaço` pausa · `Esc` volta ao tablet · `R` reconhece o alerta de maior prioridade · `P` passo feito · `A` abortar · `S` seguir · `H` histórico · `M` som · `V` voz · `1` a `8` cenários · `0` limpa os cenários.

## Catálogo de alertas

Quatro níveis, cada um com cor, forma do ícone e som próprios. O alerta mostra causa, consequência e ação. Na tela ficam no máximo três (o de maior prioridade aberto), o resto vai para o histórico (últimos 60 registros). Emergência e perigo voltam a soar (a cada 3 s e 8 s) até serem reconhecidos. Abrigado, o nível do alerta cai.

| Nível | Cor | Ícone | Som |
|---|---|---|---|
| Informação | ciano | círculo | um toque |
| Atenção | âmbar | triângulo | dois tons subindo |
| Perigo | laranja | losango | três toques |
| Emergência | vermelho, piscando | octógono | sirene de dois tons |

| Alerta | Nível | Dispara quando | Abre protocolo |
|---|---|---|---|
| Evento solar | emergência | radiação externa acima do normal (cenário: 40×) | sim |
| Tempestade de poeira | perigo; emergência quando a frente chega | frente prevista (cenário: chega em 40 min) | sim |
| Frio abaixo da faixa do traje | perigo | ar abaixo de -60 °C | sim |
| Vento forte | atenção a partir de 15 m/s; perigo a partir de 25 m/s | cenário: rajadas de 28 m/s | sim |
| Rádio sem resposta | atenção; perigo depois de 10 min | cenário: falha do rádio do traje | sim |
| Pane do veículo | perigo; emergência se a volta a pé não fecha | cenário, só no plano com veículo | sim |
| O₂ abaixo da reserva | emergência | O₂ abaixo de 10%, por cenário ou por consumo | sim |
| Traje danificado | emergência com vazamento de 10 %/h ou mais; perigo depois do selante | cenário: integridade cai para 78% | sim |
| O₂ não cobre o plano | perigo; atenção se só invade a reserva | projeção do plano | não |
| Ponto de não retorno | atenção a 500 m dele; depois, atenção com veículo e perigo a pé | projeção do plano | não |
| Declive forte à frente | atenção a partir de 15°; perigo a partir de 20° | perfil dos próximos 60 m | não |
| Rochas cortantes por perto | atenção | a menos de 200 m da zona | não |
| Bateria | atenção abaixo de 30%; perigo abaixo de 15% | leitura do traje | não |
| Dose | atenção em 60% do limite; perigo no limite | dose acumulada | não |
| Sem visada direta com o habitat | informação | relevo entre o astronauta e o mastro | não |
| Coleta, saída encerrada | informação | durante a parada e ao chegar | não |

## Protocolos

Todo protocolo segue a mesma forma: **confirmar** os primeiros passos, **decidir** (seguir ou abortar, com recomendação calculada), **ir** ao abrigo (fecha sozinho na chegada) e **encerrar**. Ao abrir, o astronauta para. Se o alerta agrava depois de um "seguir", a decisão reabre.

O título e a evidência vêm de `data/protocolos.js` (propostas da equipe). O texto dos passos foi reescrito aqui para caber nessa forma, então **não é idêntico** ao do tablet.

| Protocolo (id da equipe) | Passos antes da decisão | Abrigo, em ordem | Recomendação |
|---|---|---|---|
| Evento solar (`evento-solar`) | Pare a coleta e guarde as amostras. Confira o alarme do dosímetro. | habitat, veículo, relevo; prazo de 1 h | sempre abortar |
| Tempestade (`tempestade`) | Limpe o visor e acenda as luzes. Guie-se pela linha da rota. | habitat, veículo, relevo; prazo é a chegada da frente | seguir se a rota fecha 15 min antes da frente; senão abortar |
| Frio (`temperatura`) | Confira aquecimento de luvas e botas. Corte as paradas longas. | o mais próximo entre veículo e habitat | abortar se a bateria fecharia a rota abaixo de 15% |
| Vento (`vento`) | Prenda o equipamento. Afaste-se de encostas e blocos. | veículo, habitat, relevo; prazo de 30 min | abortar se há declive forte ou rochas cortantes à frente |
| Rádio (`radio`) | Canal reserva. Procure linha de visada. | habitat | seguir até 10 min de silêncio; depois abortar |
| Pane do veículo (`pane-veiculo`) | Freie e fique na cabine. Leia as falhas e tente religar uma vez. | habitat a pé se o O₂ alcança; senão o veículo | sempre abortar |
| O₂ (`oxigenio`) | Pare o esforço. Abra o tanque reserva. | o mais próximo entre veículo e habitat | sempre abortar |
| Queda · traje danificado (próprio) | Confira dor, visão e movimento. Ache o dano. Aplique o selante (reduz o vazamento). | o mais próximo entre veículo e habitat | sempre abortar |

Passo final de cada um: ficar abrigado até a condição passar. No O₂, o passo final reabastece o traje se o abrigo for o veículo.

## O que é real e o que é simulado

| Real | Fonte |
|---|---|
| Relevo, declive, altitude | DEM USGS/JPL (o mesmo do protótipo) |
| Rotas, distâncias, paradas | `data/travessia.js` |
| Tempo de volta a pé ao habitat | `context.safety.walkBackAt`, roteador sobre o DEM |
| Visada do rádio com o habitat | `context.safety.commsAt` e `plan.safety.commsGaps` |
| Local e céu encoberto do abrigo no relevo | `context.safety.nearestShelter` (estimativa geométrica sobre o DEM) |
| Zona de rochas cortantes | `data/travessia.js` (posição aproximada) |

| Hipótese ou simulado | Onde está |
|---|---|
| Consumo de O₂ e de bateria | `SIM` em `src/simulation.js` |
| Reserva de O₂ de 10%, alturas de antena | `ASSUMPTIONS` em `src/safety.js` |
| Radiação, temperatura, vento | camadas simuladas do protótipo |
| Limite de dose da saída (1.000 µSv), mínimo do traje (-60 °C), limites de vento, 10 min de silêncio de rádio | `RULES` em `catalog.js`, regras deste protótipo |
| Pressão e integridade do traje, vazamento | `catalog.js`. Só o valor nominal de 29,6 kPa (4,3 psi) é o do traje EMU |
| Proteção de cada abrigo contra evento solar (habitat 90%, veículo 50%, relevo igual ao céu encoberto) | `FAULTS.exposure` em `catalog.js` |
| Todos os cenários do painel e o assistente | motor de regras, sem modelo de linguagem e sem API externa |

Na tela: "simulado" no bloco do traje, "sim." em cada leitura simulada do ambiente, "calc." no rádio, "estimado" na lista de abrigos, "IA simulada · motor de regras" no assistente e "simulados" no painel de cenários.

Cuidado com a proteção do relevo: o RAD mediu só 4% de queda na radiação total junto a um paredão (ver `docs/pesquisa.md`). O modelo daqui é mais generoso e vale só para evento solar. É o primeiro número a revisar.

## O que eu precisaria dos módulos compartilhados

1. **Geometria da volta a pé.** `walkBackAt` devolve só o tempo. O visor anima a volta pela linha da rota e ajusta o ritmo para fechar com esse tempo (o previsto e o simulado batem, conferido no `check.mjs`), mas o caminho desenhado não é o caminho real. Pedido: `safety.walkBackPath(x, z)`.
2. **Caminho até o abrigo no relevo.** Hoje a ida é em linha reta, fora da rota, sem desvio de obstáculo.
3. **Tipo de cada passo em `data/protocolos.js`** (`confirmar`, `decidir`, `ir`, `aguardar`), para o visor conduzir os passos da equipe sem reescrevê-los. E faltam dois protocolos lá: queda ou traje danificado (texto proposto em `catalog.js`) e, do lado do visor, o de atolamento, que existe nos dados mas não tem cenário aqui.
4. **Posição do veículo no plano.** No plano de veículo com extensão, os trechos 3→4 e 4→5 são a pé, mas a volta a partir da parada 5 é dirigida, como se o veículo tivesse ido junto. O Guardião considera o veículo parado no último ponto dirigível.
5. **`airTemperature` exportada** de `src/simulation.js` (foi copiada em `readout.js`).
6. **Marcas no terreno pelo `overlays`.** O ponto de não retorno e o abrigo são projetados no DOM a partir da câmera. Um `overlays.setMarker(id, posição, texto)` deixaria isso igual aos pinos.
7. **Decisão da equipe sobre rádio.** Pela visada direta, 7,3 km dos 9,0 km da rota a pé ficam sem enlace com o habitat. Tratei como informação, não como alerta, porque senão o visor nunca mostraria "seguro". Com repetidor ou orbital a regra muda.
8. **Fonte para os limites** de dose, temperatura do traje e vento, hoje regras do protótipo.

## Roteiro de demonstração (60 segundos)

Preparação: plano **Veículo** com **extensão** marcada, entrar no visor, velocidade 60×.

1. **0–10 s · Seguro.** Mostrar a faixa verde "Seguro" e a pergunta do bloco central: "Se o veículo quebrar aqui, volto a pé? Sim". Apontar a barra da rota: o trecho vermelho é onde a resposta vira não.
2. **10–20 s · Ponto de não retorno.** Arrastar a barra de posição até pouco antes do trecho vermelho (cerca de 52%). O visor avisa "Ponto de não retorno próximo" e a marca aparece presa ao terreno.
3. **20–35 s · Pane do veículo.** Tecla `6`. Alerta de perigo com causa, consequência e ação. O assistente conduz: `P`, `P`, e na decisão recomenda abortar com o tempo de volta e o O₂ na chegada. Tecla `A`: o astronauta dá meia-volta.
4. **35–50 s · Evento solar.** Tecla `0` para limpar, `2` para o evento. Emergência, moldura vermelha, dose subindo contra o limite. `R` reconhece, `P`, `P`, `A`: o abrigo indicado é o relevo, com distância, tempo e O₂.
5. **50–60 s · Histórico e fecho.** Tecla `H`: tudo ficou registrado com horário. Frase final: o visor não mostra só dados, ele diz se dá para voltar e o que fazer.

## O que foi verificado e o que não foi

Verificado no navegador embutido (Chromium), em 1440×900 e 375×812, sem erro no console: plano a pé, plano de veículo com extensão, evento solar até o habitat e até o relevo (com retomada da rota), pane do veículo, vento, traje danificado, ponto de não retorno antes e depois, histórico, reconhecimento, atalhos de teclado.

Não verificado:

- **Som e voz audíveis.** Com os dois ligados o visor seguiu rodando sem erro, mas não ouvi a saída.
- **Poeira, frio, rádio e O₂ no navegador.** Estão cobertos pelo `check.mjs`, não passei por cada um na tela.
- **Plano de destino livre** (`plan.isCustom`). O código só usa `plan.stops`, mas não abri um no visor.
- **Firefox e Safari**, e leitor de tela.
