# Visor navegador · notas

Tese: o astronauta nunca fica em dúvida de onde está, para onde vai e o que o chão à frente vai exigir. Abrir com `?visor=navegador`.

Checagem da matemática e dos componentes (roda no Node, usa o relevo real se o arquivo existir):

```bash
node prototipo/visores/navegador/check.mjs
```

## Para a junção com o Guardião

O que foi pedido para entrar no visor unificado: **minimapa, perfil à frente, guia de direção e rádio**. Os quatro funcionam sem o HUD do navegador. Todos partem da mesma análise da rota, que é lógica pura:

```js
import { analyzePlan } from '../navegador/analise.js';
import { antennaFrom } from '../navegador/radio.js';

const antenna = antennaFrom(context.safety?.assumptions);      // { suit, habitat } em metros
const analysis = analyzePlan(plan, context.terrain, antenna);   // uma vez por plano (2 a 5 ms); guardar
```

O estilo dos três componentes visuais está em `componentes.css`, que não depende de `.navegador`. Importar no CSS do outro visor: `@import url('../navegador/componentes.css');`

### Minimapa

```js
import { createMinimap, ZOOM_RADII_M, DEFAULT_ZOOM } from '../navegador/minimapa.js';

const minimap = createMinimap(canvas);        // <canvas class="navegador-minimapa">
minimap.setPlan(plan, analysis);              // a cada start(plan)
minimap.draw({                                 // umas 10 vezes por segundo; só redesenha se algo mudou
  x, z,                                        // posição, em metros locais
  headingDeg,                                  // rumo do corpo: fica para cima no mapa
  lookDeg,                                     // para onde o olhar está virado em relação ao corpo
  distM,                                       // distância percorrida na rota
  radiusM: ZOOM_RADII_M[zoomIndex],            // 150, 400, 1000 ou 2500
  targetId,                                    // id da próxima parada (fica destacada)
  rejoin: null,                                // ou { x, z } do ponto de retomada, fora da rota
  radio: { visible, blockAtM },                // visada agora e a que distância está o bloqueio
});
```

O lado do canvas vem da variável CSS `--navegador-minimapa-lado` (214 px por padrão).

### Perfil à frente

```js
import { createProfile } from '../navegador/perfil.js';

const profile = createProfile(canvas);        // <canvas class="navegador-perfil-tela">
profile.setPlan(plan, analysis);
const { aheadM, gainM, peakDeg } = profile.draw(distM);   // devolve o resumo para uma legenda
```

A altura vem de `--navegador-perfil-altura` (86 px por padrão); a largura é a do elemento pai.

### Guia de direção

```js
import { createWorldGuide, createEdgeIndicator } from '../navegador/mundo.js';
import { nextManeuver } from '../navegador/analise.js';
import { routeInstruction } from '../navegador/assistente.js';

const edge = createEdgeIndicator();           // opcional: seta e rótulo do indicador de borda
mount.append(canvas, edge);                   // <canvas class="navegador-mundo"> cobrindo a cena
const world = createWorldGuide({ canvas, camera, heightAt: terrain.heightAt, edge });

// A cada quadro, depois de posicionar a câmera e chamar camera.updateMatrixWorld():
world.draw({
  analysis, distM,
  limitM,                                      // até onde desenhar: a próxima parada ou o fim da rota
  onFoot, color, timeS,                        // tamanho, cor e animação das divisas
  eye: camera.position,
  maneuver: nextManeuver(analysis, distM, 20), // curva que ganha destaque e etiqueta de distância
  feet: { x, z }, rejoin: null,                // linha de retomada quando fora da rota
  cssWidth, cssHeight,                         // tamanho do elemento que cobre a cena
});
world.pointTo({ x, y, z, label }, { left, top, width, height });   // alvo e área livre do visor

// Texto passo a passo ("Em 120 m, vire à esquerda e suba 14°"):
const step = routeInstruction(analysis, distM, target, onFoot);     // { text, turnDeg, distM, key, ... }
```

`target` é `{ kind: 'stop'|'return', distM, etaH, name, stop: { id } }`, o mesmo formato do `target` de `deriveReadout` da simulação compartilhada.

### Rádio

```js
import { lineOfSight } from '../navegador/radio.js';
import { HABITAT, radioAhead } from '../navegador/analise.js';
import { radioReading } from '../navegador/leitura.js';

const now = lineOfSight(terrain.heightAt, { x, z, antennaM: antenna.suit }, { ...HABITAT, antennaM: antenna.habitat });
// now = { visible, clearanceM, blockAtM, distM }. Se houver context.safety.commsAt, é ele quem decide `visible`.
const radio = radioReading(analysis, distM, now, planSpeedKmh);
// radio.status ('clear'|'marginal'|'blocked'), radio.route ({ visible, sinceM, changeInM, nextLengthM }),
// radio.lossInM, radio.lossLengthM e radio.lossSoon (a próxima perda de 40 m ou mais, e se está a poucos minutos)
```

Os trechos sem rádio da rota vêm de `plan.safety.commsGaps` quando o plano traz a avaliação de segurança.

## Mapa dos módulos

"Pura" = sem DOM, sem canvas, roda no Node. Todos os módulos puros estão cobertos por `check.mjs`.

| Arquivo | O que faz | Exporta | Tipo |
|---|---|---|---|
| `radio.js` | Linha de visada antena a antena sobre o relevo, com a curvatura de Marte | `lineOfSight`, `antennaFrom`, `ANTENNA_M` | Pura |
| `terreno.js` | Inclinação em dois eixos, declive no rumo, classe de declive, zona de rochas, projeção na rota, ritmo simulado | `groundAttitude`, `slopeAlongHeading`, `slopeLevel`, `limitFor`, `SLOPE_LIMIT_DEG`, `hazardStatus`, `hazardEdgeM`, `hazardSideOf`, `HAZARD_WARN_M`, `projectOnRoute`, `paceFactor` | Pura |
| `analise.js` | Uma vez por plano: rota amostrada a cada 10 m, declive, ritmo, rádio, risco, curvas; e as consultas sobre isso | `analyzePlan`, `routeAt`, `nextManeuver`, `slopeAhead`, `nextSteep`, `hazardAhead`, `radioAhead`, `HABITAT`, `STEP_M` | Pura |
| `sim.js` | Estado da saída e avanço no tempo, nos trilhos e na caminhada livre | `createNavState`, `patchState`, `advance`, `jumpTo`, `setFree`, `scheduleH`, `elapsedH`, `FREE` | Pura |
| `leitura.js` | Leitura de um instante (ritmo, alvo, traje, terreno, rádio, volta a pé) e os alertas por severidade | `deriveReadout`, `radioReading`, `NAV`, `fmtBearing`, `fmtMinutes` | Pura |
| `assistente.js` | Motor de regras: instrução principal e até três avisos; voz | `buildGuidance`, `routeInstruction` (puras); `createSpeaker` (usa `speechSynthesis`) | Pura, menos a voz |
| `minimapa.js` | Minimapa girando com o rumo | `createMinimap`, `ZOOM_RADII_M`, `DEFAULT_ZOOM` | Canvas 2D (recebe o canvas) |
| `perfil.js` | Perfil de altitude à frente com faixa de rádio | `createProfile`, `PROFILE_WINDOW_M` | Canvas 2D (recebe o canvas) |
| `mundo.js` | Divisas no chão, etiqueta da curva, linha de retomada, indicador de borda | `createWorldGuide`, `createEdgeIndicator` | Canvas 2D + câmera Three.js; `createEdgeIndicator` cria DOM |
| `hud.js` | Marcação do HUD e atualização dos textos | `createHud` | DOM (só serve a este visor) |
| `visor.js` | `createVisor`: liga tudo, câmera, teclado, controles | `createVisor` | DOM (só serve a este visor) |
| `componentes.css` | Estilo do minimapa, do perfil, da guia e do indicador de borda | | CSS reutilizável |
| `visor.css` | Layout do HUD em três larguras; importa `componentes.css` | | CSS deste visor |
| `check.mjs` | Checagem em Node: matemática, simulação, leitura, regras e os três componentes com um canvas de mentira | | Teste |

Dependências entre os módulos: `radio` e `terreno` não dependem de nada daqui; `analise` usa os dois; `sim` usa `analise` e `terreno`; `leitura` usa `analise`, `sim` e `terreno`; `assistente` usa `analise` e `leitura`; `minimapa`, `perfil` e `mundo` usam só `analise` (e `terreno`, no perfil).

## Pronto e pela metade

**Pronto e testado** (checagem em Node e navegador, a pé, veículo com extensão e destino livre):

- Análise da rota: declive, curvas, trechos íngremes, proximidade das rochas, cobertura de rádio.
- Rádio: visada, folga, bloqueio, quando cai e quando volta; bate com `safety.commsAt` em 1.681 pontos.
- Minimapa, perfil e guia no mundo (divisas, etiqueta da curva, indicador de borda).
- Leitura do terreno (subida, tombo lateral, declive à frente) e os alertas.
- Instrução passo a passo e avisos antecipados do assistente.
- Simulação nos trilhos, barra de posição, pausa, velocidade, evento solar.
- Layout em 1440×900 e 375×812, sem conteúdo cortado.

**Funciona, mas com teste raso:**

- Caminhada livre: desvio, retomada e limite de velocidade foram testados; a chegada a uma parada andando só foi coberta pela lógica, não no navegador. Em ziguezague a projeção na rota pode pular de um trecho para o vizinho.
- Volta a pé (`safety.walkBackAt`): conferida num ponto no navegador e por casos no `check.mjs`.
- Voz: fala a instrução principal em pt-BR e para ao desligar. Não escolhe voz nem fala os avisos.
- Destino livre: testado com um destino só.

**Pela metade ou frágil:**

- Ritmo simulado: a regra que freia na subida (`paceFactor`) não foi calibrada com nada; num destino livre fica desligada, porque o roteador já corrige o tempo pelo declive.
- Oclusão das divisas: cinco amostras do relevo entre o olho e a divisa. A etiqueta da curva não tem oclusão.
- Celular: tudo cabe, mas quase não sobra área livre; com dois alertas o perfil encolhe.
- "Retorno mais curto" segue a rota (ida ou frente); não usa o caminho do roteador.
- Sem teste em Firefox e Safari, e sem passada com leitor de tela.

## O que cada indicador calcula e de onde vem

| Indicador | Cálculo | Dado |
|---|---|---|
| Divisas no chão, etiqueta da curva | Pontos da rota projetados com as matrizes da câmera; ficam apagadas se o relevo esconde | Rota + relevo USGS |
| Indicador de borda | Aparece quando a próxima parada (ou o ponto de retomada) sai da área livre do visor | Rota |
| Minimapa | Vista de cima, rumo para cima; halo verde onde a rota tem visada; linha até o habitat com X onde o relevo bloqueia | Rota, `TRACK`, `HAZARD`, relevo |
| Perfil à frente | Altura do relevo nos próximos 600 m (a pé) ou 1,2 km (veículo); linha amarela a partir de 50% do limite, laranja a partir de 75%, vermelha acima | Relevo USGS |
| Sob os pés, tombo lateral | Diferença de altura 4 m à frente/atrás e à esquerda/direita | Relevo USGS |
| À frente | Maior declive nos próximos 60 m da rota (ou no rumo atual, na caminhada livre) | Relevo USGS |
| Risco próximo | Zona de rochas cortantes, declive, texto de risco da parada, trecho bloqueado | `HAZARD` (aproximado), `STOPS` |
| Ritmo | Tempo do plano no ponto atual menos o tempo decorrido | Plano + ritmo simulado |
| Retorno mais curto | O menor entre voltar pela ida e seguir em frente, na velocidade do plano | Plano |
| Volta a pé | Horas de caminhada direta até o habitat e o O₂ que sobra; alerta se não preserva a reserva | `context.safety.walkBackAt` + traje simulado |
| Ponto sem volta (aviso) | Aviso 500 m antes do primeiro ponto em que o O₂ não cobre voltar andando | `plan.safety.noReturn` |
| Rádio, estado | Se há visada entre o traje e o mastro do habitat | `context.safety.commsAt` |
| Rádio, folga e bloqueio | Menor folga da reta antena a antena sobre o relevo e a que distância está o obstáculo | Relevo USGS (`radio.js`) |
| Rádio, "seguindo a rota" | Quando o sinal cai ou volta; halo do minimapa e faixa do perfil | `plan.safety.commsGaps` |
| Traje, radiação, temperatura | Mesmas taxas de `SIM`, aplicadas às horas decorridas | Simulado |

## Real e simulado

- **Real:** relevo (grade de 8 m do DEM USGS), posição, distâncias, altitude, inclinação, declive, curvas e a geometria do rádio. Trajeto do Curiosity e paradas vêm de `data/travessia.js`.
- **Hipótese da equipe (aparece na tela):** antenas de 2 m (traje) e 10 m (mastro) e reserva de O₂ de 10%, lidas de `context.safety.assumptions`; limites de declive de 20° a pé e 15° de veículo. O rádio não modela difração nem relé orbital.
- **Simulado (rotulado na tela):** traje, radiação, temperatura, o ritmo e o assistente, que é um motor de regras, sem IA e sem chamada externa.
- **Ficou de fora:** areia fofa (não há dado real).

## Integração com a segurança compartilhada

O visor usa `context.safety` e `plan.safety` (de `src/safety.js`), então capacete e tablet mostram os mesmos trechos sem rádio. Detalhes:

- `commsAt` só devolve se há visada. A folga e o ponto do bloqueio saem de `radio.js`, que faz a mesma geometria. Se as duas contas divergirem, o visor fica com o `commsAt` e deixa a folga em branco.
- Trecho sem rádio de menos de 40 m aparece na leitura e nos avisos, mas não dispara o alerta antecipado; o alerta olha para o próximo trecho de 40 m ou mais.
- O alerta de volta a pé usa o oxigênio de agora contra `walkBackAt`, e por isso some na volta para casa. Sem o roteador, vale `plan.safety.noReturn`, só no trecho de ida.
- Se o plano vier sem `safety` (como no `check.mjs`), a cobertura é calculada em `analise.js`.

## Achados no relevo real (14/11/2026, com as antenas acima)

| Plano | Sem visada direta | Primeira queda | Maior sombra | Declive máximo na rota |
|---|---|---|---|---|
| A pé | 7,3 de 9,0 km (81%) | 400 m | 6,1 km | 15,8° |
| A pé + extensão | 12,6 de 14,3 km (88%) | 400 m | 11,4 km | 16,2° |
| Veículo | 8,6 de 10,4 km (83%) | 580 m | 5,4 km | 12,5° |
| Veículo + extensão | 14,9 de 16,7 km (89%) | 580 m | 11,6 km | 12,5° |

Números da análise própria do visor, que une trechos de menos de 40 m; o tablet, pelo `plan.safety`, dá totais algumas dezenas de metros diferentes. A rota nunca passa do limite de declive (o planejador já desviou), então o vermelho do perfil só aparece na caminhada livre. O rádio direto com o habitat some na maior parte da travessia: argumento para relé ou repetidor.

## Pedidos aos módulos compartilhados

- Exportar `nextTarget` e `airTemperature` de `src/simulation.js` (copiei as duas para `leitura.js`).
- `fmtDistance(995)` devolve "1.000 m"; deveria virar "1,00 km".
- `context.safety.commsAt` poderia devolver também a folga e a distância do bloqueio, para o visor não recalcular a visada.
- Não usei `nearestShelter` nem os protocolos.

## Revisão de código

Uma revisão automática apontou nove pontos, nenhum grave. Corrigidos: tempo extra da caminhada livre que sobrevivia ao salto na barra; alerta de ponto sem volta que não sumia na volta; estado do rádio que podia se contradizer; trechos curtos sem rádio tratados de dois jeitos; trecho sem rádio até o fim da rota; limite de velocidade da caminhada livre contornável; rota de comprimento zero; Esc saindo do visor com a lista de velocidade aberta; leitura de estilo a cada quadro na barra. Não mexi: o tamanho dos canvas ainda é lido a cada redesenho (cerca de 10 vezes por segundo, sem efeito medido).

## Roteiro de demonstração (60 s)

1. (0–10 s) Entrar no visor a pé. Mostrar as divisas no chão, a etiqueta da curva e a instrução "Em 160 m, vire…".
2. (10–20 s) Minimapa: halo verde da rota e a linha até o habitat. Tecla `-` para afastar.
3. (20–30 s) Arrastar a barra para ~8,5%: alerta "Rádio cai em… · reporte a posição antes". Arrastar para ~16%: "Sem visada", com a folga negativa e onde volta.
4. (30–40 s) Arrastar para ~22%: rochas cortantes a 20 m, perfil com trecho amarelo, ritmo atrasado.
5. (40–50 s) Tecla `L`: caminhada livre. Virar com `D`, andar com `W`: "Fora da rota · 40 m à direita" e a linha tracejada de retomada.
6. (50–60 s) `L` de novo e "Simular evento solar": instrução de retorno com distância, tempo e O₂ ao chegar.

Teclas: espaço pausa, Esc sai, `+`/`-` zoom do minimapa, `L` caminhada livre (W A S D ou setas), `V` voz.

## Verificado

- No navegador, em 1440×900 e 375×812: a pé, a pé com extensão, veículo com extensão e destino livre; sem erro no console; cerca de 118 quadros por segundo.
- Voz: fala em pt-BR ao ligar e para ao desligar.
- `check.mjs` passa com o relevo real.
- Não verificado: Firefox e Safari, leitor de tela.
