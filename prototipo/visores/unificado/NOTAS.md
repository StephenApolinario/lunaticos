# Visor único · notas

Um visor só, feito das três variantes: o **Guardião** é a base (segurança), o **Navegador** entra como peças de navegação e o **Cientista** como assistente de campo. Abrir com `http://localhost:5183/?visor=unificado` e clicar em "Entrar no visor do capacete".

Verificação sem navegador (298 asserções, com as rotas e o DEM reais):

```bash
node prototipo/visores/unificado/check.mjs
```

## Mapa dos módulos

| Arquivo | O que faz | Tipo |
|---|---|---|
| `contexto.js` | Monta o `AssistantContext` do Cientista a partir da sessão do Guardião (`assistantContext`), responde por cima dele (`answerUnified`) e escolhe as perguntas rápidas (`unifiedQuickQuestions`) | Pura, coberta por `check.mjs` |
| `guia.js` | O que a guia no chão mostra para o estado da sessão (`guideFor`), a frase da linha do assistente (`voiceLine`), o texto do rádio à frente (`radioAheadText`), o perigo relatado dentro da lista de alertas (`withReportedHazard`) e o rótulo do alvo (`targetLabel`) | Pura, coberta por `check.mjs` |
| `visor.js` | `createVisor` do contrato: câmera, teclado, ponteiro, som e o laço de quadros. Adaptado de `guardiao/visor.js` | Navegador |
| `hud.js` | Marcação e desenho do HUD no desenho "cabine escura", escrevendo só o que mudou. Reaproveita os painéis de alerta, protocolo, abrigos e histórico de `guardiao/panels.js` | Navegador |
| `navegacao.js` | Liga minimapa, perfil, guia no chão, indicador de borda e rádio do Navegador à sessão do Guardião | Navegador |
| `campo.js` | Liga conversa, ciência da parada, diário, perigos e marcadores do Cientista à sessão do Guardião, com uma voz só | Navegador |
| `visor.css` | Importa o CSS dos três visores e acrescenta o layout, com os prefixos `cabine-` e `unificado-` | CSS |

Nenhum arquivo dos três visores foi copiado inteiro. Toda a lógica pura é importada das pastas irmãs. Só a cola de navegador do Guardião (`visor.js`, `hud.js`) foi adaptada, porque o layout é outro; `guardiao/panels.js` e `guardiao/audio.js` são usados como estão. Três trechos curtos de texto de tela, que nas origens moram em arquivos de HUD e não são exportados, foram reescritos: o texto do rádio à frente (de `navegador/hud.js`, `renderRadio`), e o resumo de segurança do plano e o estado da parada (de `cientista/visor.js`).

## O que veio de cada variante e como está ligado

**Guardião (base).** `createSession` e `stepSession` ditam posição, tempo, traje, análise, alertas e protocolos. A pilha de alertas, o painel de protocolo, a lista de abrigos, o histórico, a faixa de retorno a pé com o ponto de não retorno, as marcas no terreno, os cenários, o som e os atalhos são os dele. É o único sistema de alertas na tela: os alertas do Navegador e do Cientista não são calculados.

**Navegador.** `analyzePlan` roda uma vez por plano. A cada quadro, `navegacao.js` passa `session.pos`, `state.distM` e a leitura `r` para:

- o minimapa (`createMinimap`), no canto inferior direito, com zoom nos botões e nas teclas `+` e `-`;
- o perfil à frente (`createProfile`), dentro da folha "Próxima parada e terreno à frente";
- a guia no chão e o indicador de borda (`createWorldGuide`), com os limites calculados em `guideFor`;
- o rádio à frente (`radioReading`), que aparece na folha da próxima parada e na resposta do assistente sobre rádio.

A instrução passo a passo (`routeInstruction`) é a frase padrão da linha do assistente e a resposta a "para onde eu vou agora?".

**Cientista.** `createPanel` é a gaveta (Conversa, Ciência, Diário). `createConversation` recebe `answerUnified` como motor e o contexto montado da sessão do Guardião. O diário, o relato de perigos (com `localStorage`), os marcadores na cena e a escuta por microfone são os dele. Chegar a uma parada pausa a sessão do Guardião e abre a aba Ciência.

### Contexto do assistente

`assistantContext` chama `buildContext` do Cientista com uma leitura no formato da simulação compartilhada, feita da leitura do Guardião, e passa os alertas dele já prontos (emergência e perigo viram `critico`). Depois troca os campos em que o Guardião sabe mais: O₂ e bateria ao fim do plano, volta a pé com vazamento, ponto de não retorno pelo O₂ de agora, a pé ou na cabine. O contexto é montado sob demanda com a sessão do instante, não com a do último quadro, para um comando dado logo depois de outro não ver um passo de protocolo antigo.

`context.protocol` vai sempre nulo. O protocolo em condução é o do Guardião e fica em `context.guardiao.protocol`; quem responde sobre ele é `answerUnified` (motivo na seção de defeitos).

### Ações da conversa

| Ação | O que faz no Guardião |
|---|---|
| `protocol-advance` ("feito") | `confirmCurrentStep` |
| `protocol-decide` ("abortar", "seguir"), só no passo de decisão | `decideCurrent` |
| `protocol-end` ("encerrar emergência") | Desliga o cenário simulado que abriu o protocolo. Se a condição não veio de cenário, recusa e repete o passo |
| `pause`, `resume` | `setPaused` |
| `report-hazard` | `createHazardStore().report` e registro no diário |
| `record-sample` | `createJournal().recordSample` |

Pergunta nunca vira comando: "devo abortar?" devolve a recomendação, sem decidir.

### Uma voz só

A linha do assistente no HUD e o histórico da gaveta mostram a mesma fala. Passo de protocolo, alerta e aviso preventivo do Guardião entram no histórico quando o assunto muda; respostas do Cientista ocupam a linha por alguns segundos e voltam para a frase do momento. Um aviso ou alerta repetido só volta ao histórico depois de 45 s. Quem fala em voz alta é o áudio do Guardião, com a prioridade dele; do módulo de voz do Cientista só se usa a escuta. O botão "Voz" dos controles, a tecla `V` e o botão do cabeçalho da gaveta mudam o mesmo estado. "Som" (tecla `M`) cala só os tons de alerta.

## Layout

O desenho é a "Opção A · Cabine escura", escolhida pela equipe entre três propostas porque o visor anterior tinha informação demais na tela. A vista do terreno fica livre e só o que se usa o tempo todo aparece.

**Sempre na tela.** No alto, à esquerda, uma linha com o tempo de saída, a hora local e o modo. No alto, ao centro, o rumo e a pílula da próxima parada (nome, distância e tempo). Embaixo, à esquerda, três blocos: O₂, bateria e volta a pé. Embaixo, ao centro, uma barra só, com o estado de segurança, a frase da IA e os botões de conversar e falar. Embaixo, à direita, o minimapa redondo.

**A pedido.** A pílula abre a folha "Próxima parada e terreno à frente" (distância, chegada, desnível, declive, perfil e rádio à frente). Os blocos de O₂ e bateria abrem "Traje e ambiente" (todas as leituras, com a ressalva de cada uma e a origem). O bloco de volta a pé abre "Volta a pé e abrigo" (o veredito, a faixa da rota com o ponto de não retorno e onde se abrigar). Abre uma folha por vez; `Esc` fecha.

**Alertas e protocolo.** Aparecem sozinhos no alto, ao centro, e não saem. O alerta mais grave abre causa, consequência e ação; do protocolo aparece o passo de agora, com o botão "Passo feito". Um quarto bloco, ao lado dos três, mostra a leitura que explica o alerta (`alertReading`, em `guia.js`).

**O que a IA põe e tira.** Os cartões que a IA fixa entram na mesma fileira dos blocos (até seis) e sobem para uma linha de cima quando falta espaço. Pedir uma leitura que já está na tela (oxigênio, bateria, volta a pé, próxima parada, tempo de saída, hora) não cria cartão repetido: a peça que existe pisca e a IA diz onde ela fica. Os três blocos saem a pedido e voltam sozinhos em qualquer alerta de atenção para cima; essa regra é decisão da equipe. "Leituras" abre e fecha a folha "Traje e ambiente"; "mapa" é o minimapa.

**Volta ao tablet.** Pelo botão "Voltar ao tablet", pela tecla `Esc` ou tocando no minimapa. Pelo minimapa, o mapa do tablet abre centrado no astronauta. Enquanto a saída está em andamento, o tablet mostra uma bolinha no ponto em que ele parou, sem texto; a posição é simulada (`outing()` em `visor.js`, `setAstronaut` em `src/overlays.js`).

**Controles do protótipo.** Uma barra fina embaixo, com "Voltar ao tablet", pausa, velocidade e a posição na rota. O botão "Controles" abre o resto: assistente, relato de perigo, histórico, som, voz e os cenários de treino.

**375×812.** A mesma ordem, empilhada: linha da saída e rumo, pílula, alertas, área livre, blocos com o minimapa ao lado e a barra. As folhas ocupam a largura toda. A gaveta do assistente vira uma folha embaixo e o visor encolhe para caber acima dela. Em tela larga a gaveta abre à direita e o visor encolhe para a esquerda dela.

## O que ficou de fora e por quê

- **Alertas do Navegador e do Cientista:** pedido do dono, a pilha do Guardião é a única.
- **Caminhada livre do Navegador (W A S D):** a posição é do motor do Guardião, que não tem esse modo.
- **Ritmo, tombo lateral e "retorno mais curto" do Navegador:** dependem da simulação dele.
- **Emergências e protocolos do Cientista:** os cenários e os protocolos são os do Guardião. Os textos dos protocolos da equipe seguem disponíveis por pergunta ("o que fazer numa tempestade de poeira?").
- **Marcador de abrigo do Cientista:** o Guardião já marca o abrigo indicado no terreno.

## Real e simulado

Igual às origens. **Real:** relevo, declive, altitude, rotas, tempo de volta a pé, visada do rádio, abrigo no relevo (estimativa geométrica), textos das paradas. **Hipótese da equipe:** alturas de antena e reserva de O₂. **Simulado e rotulado na tela:** traje ("sim." em cada leitura), radiação, temperatura, vento, cenários ("simulados"), protocolos, e o assistente ("IA simulada · motor de regras" na linha, "simulado por regras" na gaveta). Não há chamada externa nem chave.

## Defeitos encontrados nas origens e como foram contornados

1. `cientista/assistente.js:166`, `:217` e `:221` indexam `EMERGENCIES[...]` com o id do protocolo em condução. As notas do Cientista recomendam preencher `context.protocol` com o protocolo do Guardião, mas com um id que não seja `storm`, `solar`, `radio` ou `o2` (pane do veículo, vento, frio, traje) a pergunta "qual é o protocolo?" lança `TypeError`. Contorno: `context.protocol` nulo e `answerUnified` responde. Coberto no `check.mjs` para os oito cenários.
2. `guardiao/rules.js:195-213` (`preventive`): o aviso alterna entre `aviso:declive` e `aviso:radio` a cada quadro quando a rampa oscila perto do limite, e o Guardião repete a fala a cada troca. Contorno: intervalo de 45 s por assunto em `campo.js`.
3. `guardiao/visor.css:266`: a barra de cenários rola na horizontal em tela estreita. Contorno: menu de cenários abaixo de 1180 px.
4. `guardiao/visor.css:363` e `:334`: no telefone o nome do destino é cortado com reticências e o estado de segurança em duas linhas. Contorno: o nome quebra em duas linhas e o estado usa até quatro.
5. `cientista/componentes.css:147`: as perguntas rápidas rolam na horizontal abaixo de 900 px. Contorno: quebram em linhas na folha do telefone.
6. `guardiao/visor.css:104` (`.guardiao small`): a regra vaza para qualquer peça montada dentro do HUD. Contorno: uma regra para o rótulo do painel do Cientista.
7. `cientista/conversa.js:90`: `stop()` desliga a voz. Com a voz do Guardião, que guarda a preferência, isso apagaria a escolha do usuário a cada saída. Contorno: `campo.js` não chama `conversation.stop()`.
8. `navegador/mundo.js:68`: a projeção da guia presume câmera simétrica. Não chegou a ser problema porque a câmera não é deslocada; fica o aviso para quem quiser deslocar a vista.

Observação, não defeito: `safety.walkBackAt` não é monótono ao longo da rota a pé (17 min aos 531 m, 14 min aos 810 m). Na volta ao habitat o tempo mostrado pode subir antes de cair.

## Lacunas conhecidas

- **Divisas só no sentido do plano.** Voltando pela rota ou parado, a guia no chão some; ficam o indicador de borda e a linha tracejada até o abrigo no relevo.
- **Etiqueta da curva** do Navegador não tem oclusão e pode aparecer por baixo de um bloco do HUD.
- **Telefone com pouco espaço:** cabe um alerta aberto; os outros ficam no histórico. Em emergência, as folhas e o minimapa somem.
- **Uma folha aberta pode ficar por baixo de um alerta** em telas baixas: o alerta tem a frente.
- **Diário** vale por saída; só os perigos persistem.
- **Perigo relatado** não entra no histórico de alertas do Guardião; fica no diário.
- **Voz e microfone:** não ouvi a fala nem testei reconhecimento com microfone real.
- Valem as lacunas do Guardião: ida ao abrigo no relevo em linha reta, volta a pé animada pela linha da rota.

## Teclas

`Espaço` pausa · `Esc` fecha o que estiver aberto e depois volta ao tablet · `/` abre a conversa · `R` reconhece o alerta de maior prioridade · `P` passo feito · `A` abortar · `S` seguir · `H` histórico · `M` som · `V` voz · `+` e `-` zoom do minimapa · `1` a `8` cenários · `0` limpa os cenários. Digitar em qualquer campo não dispara atalho.

## Roteiro de demonstração (60 segundos)

Preparação: plano **Veículo** com **extensão**, entrar no visor, velocidade 60×.

1. **0–10 s · Seguro e orientado.** Faixa verde "Seguro", divisas no chão, minimapa no canto e a barra com a próxima curva. Abrir o bloco "Volta a pé" e apontar a faixa da rota: o trecho vermelho é onde não dá para voltar a pé.
2. **10–20 s · Pergunta.** Tecla `/`, "É seguro continuar?" e "Para onde eu vou agora?". Mostrar o rótulo "simulado por regras".
3. **20–35 s · Parada.** Arrastar a barra até pouco antes da parada 1. A simulação pausa e a aba Ciência abre: digitar uma observação, "Registrar amostra", "Concluir parada e seguir".
4. **35–50 s · Emergência pela conversa.** Tecla `6` (pane do veículo). Alerta e protocolo no alto da tela. Na conversa: "feito", "feito", "abortar". O astronauta dá meia-volta a pé.
5. **50–60 s · Memória.** "Relatar perigo" → "Areia fofa". Aba Diário: tudo registrado, exportável. Fecho: recarregar a página mostra o relato de volta e o aviso ao se aproximar.

## Verificado e não verificado

Verificado no navegador embutido (Chromium), sem erro no console:

- **1440×900:** entrar no visor; minimapa, perfil e guia mudando com o movimento; mais de doze perguntas variadas; `/` abrindo a conversa e texto digitado com letras e números de atalho sem disparar nada; chegada à parada, amostra pelo formulário e pela conversa, texto de exportação conferido (capturado sem baixar o arquivo); relato de perigo pelo menu e por comando, de volta depois de recarregar, com aviso na pilha, marcador na cena e reconhecimento por `R`; evento solar conduzido pela conversa até o fim; pane do veículo pelas teclas `P`, `P`, `A`, `P`; vento pelos botões do painel; "encerrar emergência"; reconhecer pelo botão; barra de posição arrastada no meio de um protocolo; sair e entrar de novo; veículo com extensão; destino livre com chegada e amostra.
- **375×812:** layout sem bloco fora da tela, sem sobreposição e sem rolagem horizontal, com e sem minimapa, leituras, gaveta, menu de cenários e protocolo; protocolo de vento pela conversa.

As passadas de veículo com extensão, destino livre e relato de perigo com recarga foram feitas antes dos três últimos ajustes (área livre do telefone, contexto do assistente montado com a sessão do instante, registro de protocolo no diário). Depois deles repeti, em 1440×900: entrada, auditoria do layout, perguntas, campo de texto com teclas de atalho, evento solar pela conversa até o fim, vento pelos botões, sair e entrar de novo; e em 375×812: auditoria do layout com cada botão e com a gaveta.

Não verificado: som e voz audíveis, microfone, Firefox e Safari, leitor de tela, e o clique real em "Exportar .txt" (o download em si).

O painel de teste estava oculto e quase não rodava quadros: a taxa de quadros não foi medida.
