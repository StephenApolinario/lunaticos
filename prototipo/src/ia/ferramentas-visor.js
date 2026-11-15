// Ferramentas que a IA de bordo usa no visor do capacete. Cada uma lê o estado da saída no instante
// da chamada (traje, posição, relevo, clima, radiação, alertas) e devolve os valores já formatados,
// com a origem de cada um. As quatro últimas executam ações do visor a pedido do astronauta.
//
// Puro: recebe tudo por parâmetro e roda no Node (ver tools/testar-ia.mjs).

import { fmtClock, fmtDistance, fmtDuration, fmtKm, fmtNumber } from '../format.js';
import { ORIGIN, toLocal } from '../geo.js';
import { sunAt, daylightHours, compassName, EARTH_HOURS_PER_MARS_HOUR } from '../luz.js';
import { samplePath, shortName } from '../route.js';
import { RAD, REMS } from '../../data/medicoes.js';
import { HAZARD } from '../../data/travessia.js';
import { O2_PCT_PER_HOUR, SUIT_ORIGIN, SPEED_ORIGIN } from '../../data/traje.js';
import { createKnowledgeTools, createRetriever, createRoverTrips, describeSite, isOrder, MISSION_BRIEF, NOT_AN_ORDER, roverInfo, tripSummary, VEHICLE_INFO } from './ferramentas-comuns.js';
import { BASE_RULES } from './agente.js';

export const VISOR_PROMPT = `Você é a IA de bordo do visor do capacete de um astronauta em uma saída na cratera Gale, em Marte, a pé ou de veículo. DADOS DE AGORA traz a situação, o traje, a volta ao habitat e os abrigos, o ambiente e os alertas. DADOS DE AGORA traz também quanto tempo dá para ficar parado, onde é seguro parar e onde está o rover Curiosity. As ferramentas trazem o resto: o plano da saída, a simulação do plano a pé ou de veículo, a ciência de cada parada, os protocolos de emergência, as fontes pesquisadas e a calculadora.

${MISSION_BRIEF}

${BASE_RULES}`;

/** Perguntas de exemplo para os botões da conversa: [rótulo, pergunta]. */
export const VISOR_EXAMPLES = Object.freeze([
  ['Dá para voltar a pé?', 'Dá para voltar a pé para o habitat agora?'],
  ['Quanto falta de luz?', 'Quanto tempo de luz do Sol eu ainda tenho?'],
  ['Como está o traje?', 'Como estão meu oxigênio e minha bateria?'],
  ['O que coletar aqui?', 'O que devo coletar nesta parada e por quê?'],
  ['Radiação está normal?', 'A radiação está normal hoje? De onde vem esse dado?'],
  ['Onde me abrigo?', 'Onde me abrigo se vier um evento solar?'],
  ['Resumo', 'Resuma minha situação em duas frases.'],
]);

const TARGET_KIND = Object.freeze({ stop: 'parada científica', dwell: 'coleta em andamento nesta parada', return: 'retorno ao habitat', shelter: 'abrigo', done: 'fim da saída' });
const HAZARD_KINDS = Object.freeze(['rocha', 'areia', 'declive', 'outro']);
// Onde é seguro parar para descansar: critério da equipe, conferido no relevo real.
const REST = Object.freeze({ maxSlopeDeg: 5, searchM: 1500, stepM: 20 });
const SIM_MODES = Object.freeze({ veiculo: 'car', a_pe: 'walk' });
// O que a IA pode ligar e desligar no visor. Alertas, protocolo e a volta a pé nunca saem: são de segurança.
const HUD_PANELS = Object.freeze(['mapa', 'leituras', 'historico']);
const MAX_PINS = 6;
// Camadas do mapa do tablet que a IA pode pintar sobre o terreno do visor: [camada, nome curto, o que mostra].
const VISOR_LAYERS = Object.freeze({
  nenhuma: ['none', 'Sem camada', 'só a imagem e o relevo'],
  termico: ['thermal', 'Térmico noturno', 'imagem térmica noturna do THEMIS (sonda Mars Odyssey, 100 m por pixel): azul-escuro é mais frio à noite, amarelo é mais quente. Não é a temperatura de agora'],
  declive: ['slope', 'Declividade', 'declive calculado sobre o relevo real, em classes de cor'],
  radio: ['comms', 'Rádio', 'vermelho onde não há linha de visada com o habitat, azul-claro onde há'],
  radiacao: ['radiation', 'Radiação', 'taxa média do RAD, menor onde o relevo tapa o céu: do roxo (menor) ao amarelo (maior)'],
  volta_a_pe: ['walkback', 'Volta a pé', 'tempo de volta a pé ao habitat a partir de cada ponto'],
  areia: ['sand', 'Areia (estimada)', 'areia escura estimada pela cor da imagem, em roxo; não é mapa da NASA'],
});
const PROTOCOL_ACTIONS = Object.freeze({
  confirmar_passo: { type: 'protocol-advance' },
  abortar: { type: 'protocol-decide', choice: 'abortar' },
  seguir: { type: 'protocol-decide', choice: 'seguir' },
  encerrar: { type: 'protocol-end' },
});
const ALREADY_CONFIRMED = Object.freeze({ feito: true, aviso: 'A ação foi executada e o visor já mostrou a confirmação. Responda com uma frase curta dizendo que está feito.' });

const pct = (value) => `${fmtNumber(value)}%`;
// Número sem separador de milhar ("-3893", não "-3.893"), que o modelo leria como decimal.
const plain = (value, digits = 0) => value.toFixed(digits).replace('.', ',');
const duration = (hours) => (Number.isFinite(hours) ? fmtDuration(hours) : 'indisponível');
const noParams = Object.freeze({ type: 'object', properties: {} });

/**
 * @param {{
 *   getContext: () => object | null,
 *   getSession: () => { plan: object, r: object },
 *   safety: { radiationAt?: (x: number, z: number) => number, assumptions: { o2ReservePct: number } },
 *   live: () => { weather?: object | null, dose?: object | null, lsDeg: number },
 *   runAction: (action: { type: string }) => void,
 *   terrain?: { heightAt: Function, probe: Function } | null,
 * }} deps `getContext` devolve o contexto do assistente (visores/unificado/contexto.js) no instante da
 *   chamada; `getSession` a sessão do Guardião; `live` as medições lidas da NASA (src/nasa.js).
 * @returns {{ tools: ReadonlyArray<object>, snapshot: () => object }} As ferramentas que o modelo pode
 *   chamar e os dados de agora, que entram em toda pergunta.
 */
export function createVisorTools({ getContext, getSession, safety, live, runAction, terrain = null, planIn = null, tripTo = null }) {
  const roverTrips = createRoverTrips(tripTo);
  const context = () => {
    const current = getContext();
    if (!current) throw new Error('Os dados da saída ainda não estão disponíveis.');
    return current;
  };

  const knowledge = createKnowledgeTools({
    stops: () => context().stops,
    focusStop: () => context().focusStop,
    samplesAt: (stopId) => context().journal.samplesByStop?.[stopId] ?? 0,
    siteOf: terrain ? (stop) => describeSite(toLocal(stop.lat, stop.lon), { safety, terrain }) : null,
  });

  function situacao() {
    const c = context();
    const { position, target, env, riskZone } = c;
    return {
      hora_local: `${fmtClock(c.clockH)} (hora solar local, calculada pelo algoritmo Mars24 da NASA a partir da hora de partida)`,
      tempo_de_saida: fmtDuration(c.elapsedH),
      deslocamento: position.onFoot ? 'a pé' : 'no veículo',
      estado: c.finished ? 'saída encerrada no habitat' : c.paused ? 'pausada' : c.atStop ? 'em parada de coleta' : 'em deslocamento',
      posicao: {
        latitude: position.lat.toFixed(5), longitude: position.lon.toFixed(5), altitude: `${plain(position.elevM)} m`,
        origem: 'posição do astronauta na caminhada simulada sobre a rota (o protótipo não tem localização real); a altitude é do relevo real do USGS',
      },
      rota: { percorrido: fmtDistance(position.distM), falta: fmtDistance(position.totalM - position.distM), total: fmtDistance(position.totalM) },
      proximo_alvo: {
        nome: target.name, o_que_e: TARGET_KIND[target.kind] ?? target.kind, distancia: fmtDistance(target.distM), tempo_ate_la: duration(target.etaH),
        subida_ate_la: Number.isFinite(target.gainM) ? `${plain(target.gainM)} m` : undefined,
      },
      terreno: {
        declive_aqui: `${fmtNumber(env.slopeDeg)}°`, maior_declive_a_frente: `${fmtNumber(env.slopeAheadDeg)}°`,
        origem: 'calculado sobre o relevo real (modelo de elevação do USGS)',
      },
      rochas_cortantes: riskZone.near ? `a ${fmtDistance(riskZone.edgeM)} ${riskZone.side} (zona de 250 m definida pela equipe em volta do ponto onde o Curiosity deu meia-volta)` : 'fora da zona de rochas cortantes',
      areia_fofa: sandAhead(),
      orientacao_de_rota: c.guardiao?.guidance?.text ?? undefined,
      indo_para_abrigo: c.guardiao?.going ?? undefined,
    };
  }

  function traje() {
    const c = context();
    const { r } = getSession();
    return {
      oxigenio: pct(c.suit.o2Pct),
      consumo_de_oxigenio: `${fmtNumber(r.o2RatePctH, 1)}% por hora`,
      autonomia_de_oxigenio: duration(r.o2AutonomyH),
      oxigenio_ao_fim_do_plano: pct(c.suit.planEndO2Pct),
      tempo_para_terminar_o_plano: duration(c.suit.hoursToFinish),
      reserva_minima_de_oxigenio: pct(c.assumptions.o2ReservePct),
      bateria: pct(c.suit.batteryPct),
      bateria_ao_fim_do_plano: pct(c.suit.batteryEndPct),
      pressao: `${fmtNumber(r.pressureKpa, 1)} kPa`,
      vazamento: c.suit.leaking ? 'sim (cenário de treino)' : 'não',
      origem: SUIT_ORIGIN,
    };
  }

  function voltaEAbrigos() {
    const c = context();
    const { r } = getSession();
    const { habitat, noReturn } = c;
    const reserve = c.assumptions.o2ReservePct;
    let canWalkBack = 'não: o oxigênio não cobre a caminhada';
    if (habitat.o2ArrivalPct >= reserve) canWalkBack = 'sim';
    else if (habitat.o2ArrivalPct > 0) canWalkBack = 'sim, mas chegando abaixo da reserva mínima';
    let pointOfNoReturn = 'não há neste plano';
    if (noReturn) pointOfNoReturn = noReturn.aheadM > 0 ? `daqui a ${fmtDistance(noReturn.aheadM)} na rota` : 'já ficou para trás';
    return {
      volta_a_pe_ao_habitat: {
        da_para_voltar: canWalkBack,
        caminhada: habitat.walkH === null ? 'sem caminho a pé conhecido no relevo' : duration(habitat.walkH),
        oxigenio_gasto_na_volta: pct(habitat.o2UsePct),
        oxigenio_na_chegada: pct(habitat.o2ArrivalPct),
        reserva_minima: pct(reserve),
        origem: 'calculado: caminho a pé sobre o relevo real do USGS e o consumo de oxigênio do traje',
      },
      ponto_sem_volta_a_pe: pointOfNoReturn,
      abrigos: (r.shelters ?? []).map((option) => ({
        abrigo: option.name,
        tempo_ate_la: duration(option.timeH),
        distancia: Number.isFinite(option.distM) ? fmtDistance(option.distM) : undefined,
        oxigenio_na_chegada: pct(option.o2AfterPct),
        alcanca: !option.reaches ? 'não' : option.usesReserve ? 'sim, usando a reserva' : 'sim',
        ceu_tapado_pelo_relevo: Number.isFinite(option.skyBlocked) ? pct(option.skyBlocked * 100) : undefined,
      })),
      abrigo_indicado: r.nearestShelter?.name ?? undefined,
    };
  }

  function ambiente() {
    const c = context();
    const { weather, dose, lsDeg } = live();
    const sun = sunAt(ORIGIN.lat, lsDeg, c.clockH);
    const { sunriseH, sunsetH } = daylightHours(ORIGIN.lat, lsDeg);
    const hourOfSol = ((c.clockH % 24) + 24) % 24;
    const isDay = hourOfSol >= sunriseH && hourOfSol < sunsetH;
    const here = safety.radiationAt?.(c.position.x, c.position.z);
    return {
      radiacao: {
        taxa_agora: `${fmtNumber(c.env.radiationUsvH, 1)} µSv/h`,
        origem_da_taxa: c.emergencies.solar
          ? `cenário de treino de evento solar: a média medida pelo RAD multiplicada por ${RAD.solarEventFactor}, como no evento de 11/09/2017`
          : `medido: média do RAD do Curiosity em Gale, ${String(RAD.surfaceMsvPerDay).replace('.', ',')} mSv por dia`,
        dose_desta_saida: `${plain(c.env.doseUsv)} µSv (estimada: a taxa multiplicada pelo tempo de saída)`,
        taxa_neste_ponto_com_o_relevo: Number.isFinite(here) ? `${fmtNumber(here, 1)} µSv/h (estimado: o relevo tapa parte do céu)` : undefined,
        medicao_recente_do_rad: dose
          ? `${fmtNumber(dose.ugyPerDay)} µGy por dia de dose absorvida, média de ${dose.days} dias até ${dose.until.toLocaleDateString('pt-BR', { timeZone: 'UTC' })} (medido, lido do NASA CCMC)`
          : 'indisponível agora (sem rede)',
      },
      temperatura: {
        ar_agora: `${fmtNumber(c.env.airTempC)} °C (estimado para esta hora entre a mínima e a máxima medidas)`,
        faixa_medida: weather
          ? `ar de ${fmtNumber(weather.air.minC)} a ${fmtNumber(weather.air.maxC)} °C e solo de ${fmtNumber(weather.ground.minC)} a ${fmtNumber(weather.ground.maxC)} °C, média de ${weather.sols} sols desta estação medidos pelo REMS do Curiosity`
          : `ar de ${REMS.air.minC} a ${REMS.air.maxC} °C e solo de ${REMS.ground.minC} a ${REMS.ground.maxC} °C em um sol típico de 2012, medido pelo REMS (valor de reserva, sem rede)`,
        pressao_do_ar: weather ? `${plain(weather.pressurePa)} Pa (medido pelo REMS)` : 'indisponível agora (sem rede)',
      },
      sol: {
        altura_no_ceu: isDay ? `${fmtNumber(sun.elevationDeg)}°` : 'abaixo do horizonte',
        direcao: isDay ? compassName(sun.azimuthDeg) : undefined,
        nascer_do_sol: fmtClock(sunriseH),
        por_do_sol: fmtClock(sunsetH),
        luz_restante: isDay ? fmtDuration((sunsetH - hourOfSol) * EARTH_HOURS_PER_MARS_HOUR) : 'nenhuma: é noite',
        origem: 'calculado pelo algoritmo Mars24 da NASA para a estação de hoje em Marte; não conta a poeira',
      },
      vento: c.guardiao?.wind ?? 'sem medição: o sensor de vento do REMS parou no sol 1491',
      radio: {
        com_o_habitat_agora: c.comms.failed ? 'falha de rádio (cenário de treino)'
          : c.comms.lineOfSight === false ? `sem linha de visada; volta em ${fmtDistance(c.comms.backInM)} de rota` : 'com linha de visada',
        seguindo_a_rota: c.guardiao?.guidance?.radio ?? undefined,
        origem: 'calculado: linha de visada até o mastro do habitat sobre o relevo real; as alturas das antenas são hipótese da equipe',
      },
    };
  }

  // Quanto tempo dá para ficar parado sem perder a volta nem o plano. Usa o consumo de quem
  // caminha: parado o gasto é menor, então o resultado é o mínimo garantido.
  function pararAqui() {
    const c = context();
    const { sunsetH } = daylightHours(ORIGIN.lat, live().lsDeg);
    const hourOfSol = ((c.clockH % 24) + 24) % 24;
    const lightH = Math.max(0, (sunsetH - hourOfSol) * EARTH_HOURS_PER_MARS_HOUR);
    const reserve = c.assumptions.o2ReservePct;
    const rate = O2_PCT_PER_HOUR.foot;
    const limit = (o2H, sunH) => {
      const hours = Math.min(o2H, sunH);
      return hours > 0 ? `${fmtDuration(hours)} (quem limita é ${o2H <= sunH ? 'o oxigênio' : 'a luz do Sol'})` : 'nenhum: é preciso sair agora';
    };
    return {
      pode_ficar_parado_e_ainda_voltar_a_pe_ao_habitat: c.habitat.walkH === null ? 'sem caminho a pé conhecido até o habitat'
        : limit((c.suit.o2Pct - reserve - c.habitat.o2UsePct) / rate, lightH - c.habitat.walkH),
      pode_ficar_parado_e_ainda_terminar_o_plano: limit((c.suit.planEndO2Pct - reserve) / rate, lightH - c.suit.hoursToFinish),
      origem: 'calculado: o oxigênio de agora menos a reserva e o gasto do caminho, e a luz que resta até o pôr do Sol. A conta usa o consumo de quem caminha; parado o gasto é menor, então este é o tempo mínimo garantido',
    };
  }

  // Ponto mais próximo na rota, para frente e para trás, que serve para parar e descansar.
  function pontosParaParar() {
    if (!terrain) return undefined;
    const c = context();
    const { path } = getSession().plan;
    const hazard = toLocal(HAZARD.lat, HAZARD.lon);
    const check = (distM) => {
      const point = samplePath(path, distM);
      return {
        steep: terrain.probe(point.x, point.z).slopeDeg > REST.maxSlopeDeg,
        noRadio: safety.commsAt?.(point.x, point.z).visible === false,
        sharpRocks: Math.hypot(point.x - hazard.x, point.z - hazard.z) <= HAZARD.radiusKm * 1000,
      };
    };
    // Dois níveis: chão bom para sentar e descansar, e o mesmo com rádio direto com o habitat.
    const groundOk = (found) => !found.steep && !found.sharpRocks;
    const groundAndRadioOk = (found) => groundOk(found) && !found.noRadio;
    const nearest = (direction, accepts) => {
      for (let stepM = REST.stepM; stepM <= REST.searchM; stepM += REST.stepM) {
        const distM = c.position.distM + direction * stepM;
        if (distM < 0 || distM > path.totalM) return null;
        if (accepts(check(distM))) return stepM;
      }
      return null;
    };
    const describe = (accepts) => {
      const ahead = nearest(1, accepts);
      const behind = nearest(-1, accepts);
      if (ahead === null && behind === null) return `nenhum a até ${fmtDistance(REST.searchM)} de rota, nem à frente nem atrás`;
      return [ahead !== null && `a ${fmtDistance(ahead)} à frente na rota`, behind !== null && `a ${fmtDistance(behind)} voltando pela rota`].filter(Boolean).join(' ou ');
    };
    const here = check(c.position.distM);
    const hereProblems = [here.steep && 'o chão é inclinado', here.sharpRocks && 'fica na zona de rochas cortantes', here.noRadio && 'não há rádio direto com o habitat'].filter(Boolean);
    return {
      aqui: hereProblems.length === 0 ? 'este ponto serve para parar e descansar' : `neste ponto: ${hereProblems.join(', ')}`,
      chao_bom_para_descansar_mais_proximo: groundOk(here) ? 'aqui mesmo' : describe(groundOk),
      chao_bom_com_radio_mais_proximo: groundAndRadioOk(here) ? 'aqui mesmo' : describe(groundAndRadioOk),
      criterio: `chão bom é declive de até ${REST.maxSlopeDeg}° e fora da zona de rochas cortantes; rádio é a linha de visada direta com o habitat (critério da equipe, conferido no relevo real)`,
    };
  }

  const roverCuriosity = () => {
    const c = context();
    return roverInfo(live().rover, { x: c.position.x, z: c.position.z, label: 'de onde você está' }, { safety, terrain, trips: roverTrips(live().rover) });
  };

  function simular({ modo } = {}) {
    if (!Object.hasOwn(SIM_MODES, modo)) return { erro: `Modo inválido. Use: ${Object.keys(SIM_MODES).join(' ou ')}.` };
    const simulated = planIn?.(SIM_MODES[modo]);
    if (!simulated) return { erro: 'Não consegui calcular este plano nesse modo.' };
    return {
      plano_de_agora: tripSummary(getSession().plan),
      plano_simulado: tripSummary(simulated),
      veiculo: VEHICLE_INFO,
      aviso: 'A simulação é do plano inteiro, da saída do habitat até a volta, com as mesmas paradas. Nada foi alterado na saída em andamento.',
    };
  }

  // Leituras que a IA pode fixar no visor a pedido do astronauta. Cada uma é lida de novo a cada atualização.
  const METRICS = Object.freeze({
    oxigenio: ['Oxigênio', () => pct(context().suit.o2Pct)],
    autonomia: ['Autonomia de O₂', () => duration(getSession().r.o2AutonomyH)],
    bateria: ['Bateria', () => pct(context().suit.batteryPct)],
    pressao: ['Pressão do traje', () => `${fmtNumber(getSession().r.pressureKpa, 1)} kPa`],
    temperatura: ['Temperatura do ar', () => `${fmtNumber(context().env.airTempC)} °C`],
    radiacao: ['Radiação', () => `${fmtNumber(context().env.radiationUsvH, 1)} µSv/h`],
    dose: ['Dose da saída', () => `${plain(context().env.doseUsv)} µSv`],
    velocidade: ['Velocidade', () => { const { r } = getSession(); return r.moving ? `${fmtNumber(r.m.speedKmh, 1)} km/h` : 'parado'; }],
    velocidade_media: ['Velocidade média', () => { const c = context(); return c.elapsedH > 0 ? `${fmtNumber(c.position.distM / 1000 / c.elapsedH, 1)} km/h` : 'ainda sem deslocamento'; }],
    distancia: ['Percorrido', () => { const c = context(); return `${fmtDistance(c.position.distM)} de ${fmtDistance(c.position.totalM)}`; }],
    tempo_de_saida: ['Tempo de saída', () => fmtDuration(context().elapsedH)],
    hora: ['Hora local', () => fmtClock(context().clockH)],
    luz: ['Luz que resta', () => ambiente().sol.luz_restante],
    altitude: ['Altitude', () => `${plain(context().position.elevM)} m`],
    declive: ['Declive aqui', () => `${fmtNumber(context().env.slopeDeg)}°`],
    proxima_parada: ['Próximo alvo', () => { const { target } = context(); return `${target.name} · ${fmtDistance(target.distM)}`; }],
    volta_a_pe: ['Volta a pé', () => { const { habitat } = context(); return habitat.walkH === null ? 'sem caminho conhecido' : duration(habitat.walkH); }],
    radio: ['Rádio com o habitat', () => (context().comms.lineOfSight === false ? 'sem visada' : 'com visada')],
  });
  let pinned = [];
  let visorLayer = 'nenhuma';
  const readPin = (id) => ({ id, rotulo: METRICS[id][0], valor: METRICS[id][1]() });
  /** Cartões fixados no visor agora, com o valor deste instante. */
  const pins = () => {
    if (!getContext()) return [];
    const layerCard = visorLayer === 'nenhuma' ? [] : [{ id: 'camada', rotulo: 'Camada no terreno', valor: VISOR_LAYERS[visorLayer][1] }];
    return [...pinned.map(readPin), ...layerCard];
  };

  function changeLayer(camada, question) {
    if (!isOrder(question)) return NOT_AN_ORDER;
    if (!Object.hasOwn(VISOR_LAYERS, camada)) return { erro: `Camada inválida. Use: ${Object.keys(VISOR_LAYERS).join(', ')}.` };
    visorLayer = camada;
    runAction({ type: 'hud-layer', layer: VISOR_LAYERS[camada][0] });
    return {
      feito: true,
      camada_no_terreno: `${VISOR_LAYERS[camada][1]}: ${VISOR_LAYERS[camada][2]}`,
      aviso: 'O terreno do visor já mudou. Responda em uma ou duas frases: diga qual camada está no terreno e como ler as cores.',
    };
  }

  // Areia escura estimada na rota à frente (a mesma que o planejador evita).
  function sandAhead() {
    if (!safety.sandAt) return undefined;
    const c = context();
    const { path } = getSession().plan;
    for (let aheadM = 0; aheadM <= REST.searchM; aheadM += REST.stepM) {
      const distM = c.position.distM + aheadM;
      if (distM > path.totalM) break;
      const point = samplePath(path, distM);
      if (safety.sandAt(point.x, point.z)) return aheadM === 0 ? 'você está sobre areia escura (estimada pela cor da imagem): pise firme e evite parar o veículo aqui' : `a ${fmtDistance(aheadM)} à frente na rota (estimada pela cor da imagem)`;
    }
    return `nenhuma nos próximos ${fmtDistance(REST.searchM)} de rota`;
  }

  function changeHud(itens, show, question) {
    if (!isOrder(question)) return NOT_AN_ORDER;
    const wanted = (Array.isArray(itens) ? itens : [itens]).map(String);
    const unknown = wanted.filter((id) => id !== 'tudo' && !Object.hasOwn(METRICS, id) && !HUD_PANELS.includes(id));
    if (wanted.length === 0 || unknown.length > 0) {
      return { erro: `Item que não dá para ${show ? 'mostrar' : 'tirar'}: ${unknown.join(', ') || 'nenhum informado'}. Leituras: ${Object.keys(METRICS).join(', ')}. Painéis: ${HUD_PANELS.join(', ')}. Alertas, protocolo e o quadro de volta a pé não saem da tela: são de segurança.` };
    }
    for (const id of wanted) {
      if (HUD_PANELS.includes(id)) runAction({ type: 'hud-panel', panel: id, on: show });
      else if (id === 'tudo') pinned = show ? pinned : [];
      else pinned = show ? [...pinned.filter((other) => other !== id), id].slice(-MAX_PINS) : pinned.filter((other) => other !== id);
    }
    return {
      feito: true,
      fixado_no_visor_agora: pinned.length === 0 ? 'nenhuma leitura fixada' : pins().map((pin) => `${pin.rotulo}: ${pin.valor}`),
      aviso: 'O visor já mudou. Responda em uma frase curta: diga o que mudou na tela e, se mostrou uma leitura, o valor dela.',
    };
  }

  function alertasEProtocolo() {
    const c = context();
    const protocol = c.guardiao?.protocol;
    const scenarios = getSession().state?.scenarios ?? {};
    return {
      alertas_ativos: c.alerts.length === 0 ? 'nenhum' : c.alerts.map((alert) => ({
        alerta: alert.text, o_que_fazer: alert.action, so_informacao: alert.level === 'info' ? 'sim' : undefined,
        origem: scenarios[alert.kind] ? 'cenário de treino disparado na barra do visor' : 'leituras da saída',
      })),
      protocolo_em_andamento: !protocol ? 'nenhum' : {
        nome: protocol.title,
        passo: `${protocol.stepNumber} de ${protocol.stepCount}`,
        instrucao_do_passo: protocol.stepText,
        o_passo_pede: protocol.stepType === 'decision' ? 'uma decisão do astronauta: abortar ou seguir' : protocol.stepType === 'ok' ? 'confirmar que foi feito' : 'chegar ao abrigo',
        recomendacao: `${protocol.abort ? 'abortar' : 'seguir'}: ${protocol.why}`,
        abrigo: protocol.shelter,
        origem: protocol.simulated ? 'cenário de treino disparado na barra do visor' : 'aberto pelas leituras da saída',
        base: `${protocol.source}. Os passos são proposta da equipe, não procedimento oficial da NASA.`,
      },
    };
  }

  function plano() {
    const c = context();
    const { plan } = getSession();
    const { safety: assessed } = plan;
    return {
      tipo: plan.isCustom ? 'rota livre com pontos escolhidos no mapa' : 'travessia do Monte Sharp',
      deslocamento: plan.mode === 'walk' ? 'a pé' : 'de veículo',
      hora_de_partida: Number.isFinite(plan.startClockH) ? fmtClock(plan.startClockH) : undefined,
      distancia_total: fmtKm(plan.stats.totalKm),
      duracao_prevista: fmtDuration(plan.stats.hours),
      subida_acumulada_na_ida: `${plain(plan.stats.gainM)} m`,
      maior_declive: `${fmtNumber(plan.stats.maxSlopeDeg, 1)}°`,
      paradas: plan.stops.map(({ stop, distM }, index) => ({
        id: stop.id, nome: stop.name, distancia_na_rota: fmtDistance(distM), situacao: index < c.stopsReached ? 'já visitada' : 'por visitar',
      })),
      trechos: [...plan.legs, plan.returnLeg].map((leg) => ({
        de: shortName(leg.from), para: shortName(leg.to), distancia: fmtKm(leg.len_km), subida: `${plain(leg.gain_m)} m`,
        maior_declive: `${fmtNumber(leg.max_slope, 1)}°`, veiculo_nao_passa: leg.blocked ? 'sim: trecho feito a pé' : undefined,
      })),
      seguranca_do_plano: !assessed ? undefined : {
        ponto_sem_volta_a_pe: assessed.noReturn ? `a ${fmtDistance(assessed.noReturn.distM)} do início` : 'não há',
        rota_sem_radio_direto: fmtDistance(assessed.commsLostM),
      },
      origem: `rotas calculadas sobre o relevo real (modelo de elevação do USGS). ${SPEED_ORIGIN}`,
    };
  }

  const act = (action, question) => {
    if (!isOrder(question)) return NOT_AN_ORDER;
    runAction(action);
    return ALREADY_CONFIRMED;
  };

  /** Os dados da saída neste instante, que entram junto com cada pergunta. */
  // Os alertas vêm primeiro: havendo perigo, é por eles que a resposta começa.
  const snapshot = () => {
    const alerts = alertasEProtocolo();
    // Alerta que é só informação (trecho sem rádio previsto no plano) não puxa a resposta para si.
    const urgent = context().alerts.some((alert) => alert.level !== 'info') || alerts.protocolo_em_andamento !== 'nenhum';
    return {
      prioridade: urgent ? 'HÁ ALERTA OU PROTOCOLO ATIVO: em pergunta sobre a situação, comece por ele e pela ação a tomar.' : 'sem alerta ativo',
      alertas_e_protocolo: alerts, volta_e_abrigos: voltaEAbrigos(), parar_aqui: pararAqui(), pontos_para_parar: pontosParaParar(),
      traje: traje(), situacao: situacao(), ambiente: ambiente(), veiculo_da_saida: VEHICLE_INFO, rover_curiosity: roverCuriosity(),
      visor: { camada_no_terreno: visorLayer, camadas_que_da_para_pintar_no_terreno: Object.keys(VISOR_LAYERS), leituras_fixadas_na_tela: pinned.length === 0 ? 'nenhuma' : pinned, leituras_que_da_para_fixar: Object.keys(METRICS), paineis_que_da_para_ligar_e_desligar: HUD_PANELS },
    };
  };

  const tools = Object.freeze([
    { name: 'plano', status: 'lendo o plano…', run: plano, parameters: noParams,
      description: 'Plano da saída: distância e duração totais, hora de partida, paradas (visitadas ou não), trechos com distância, subida e declive, e a segurança do plano.' },
    { name: 'simular_deslocamento', status: 'simulando o trajeto…', run: simular,
      description: 'Simulação, sem mudar nada: como fica o plano inteiro desta saída, com as paradas de coleta, feito de veículo ou a pé: distância, duração total, tempo nas paradas, oxigênio gasto e trechos em que o veículo não passa. Traz também os dados do veículo (velocidade, declive máximo, consumo). Use para "e se formos de jipe", "quanto tempo levo de veículo parando para coletar", "o veículo passa?".',
      parameters: { type: 'object', required: ['modo'], properties: { modo: { type: 'string', enum: Object.keys(SIM_MODES), description: 'veiculo ou a_pe.' } } } },
    ...knowledge,
    { name: 'registrar_amostra', action: true, status: 'registrando a amostra…',
      description: 'Ação: registra no diário uma amostra coletada aqui. Só quando o astronauta pedir para registrar.',
      parameters: { type: 'object', properties: { observacao: { type: 'string', description: 'O que foi visto e coletado, nas palavras do astronauta.' } } },
      run: ({ observacao } = {}, { question }) => act({ type: 'record-sample', note: String(observacao ?? '') }, question) },
    { name: 'relatar_perigo', action: true, status: 'registrando o perigo…',
      description: 'Ação: marca um perigo do terreno na posição atual, para avisar as próximas saídas. Só quando o astronauta relatar um perigo.',
      parameters: { type: 'object', required: ['tipo'], properties: { tipo: { type: 'string', enum: HAZARD_KINDS, description: 'rocha (cortante), areia (fofa), declive ou outro.' }, observacao: { type: 'string' } } },
      run: ({ tipo, observacao } = {}, { question }) => (HAZARD_KINDS.includes(tipo)
        ? act({ type: 'report-hazard', hazardType: tipo, note: String(observacao ?? '') }, question)
        : { erro: `Tipo de perigo inválido. Use: ${HAZARD_KINDS.join(', ')}.` }) },
    { name: 'protocolo_acao', action: true, status: 'conduzindo o protocolo…',
      description: 'Ação no protocolo de emergência em andamento: confirmar o passo atual, decidir abortar ou seguir, ou encerrar um cenário de treino. Só com ordem direta do astronauta.',
      parameters: { type: 'object', required: ['acao'], properties: { acao: { type: 'string', enum: Object.keys(PROTOCOL_ACTIONS) } } },
      run: ({ acao } = {}, { question }) => (Object.hasOwn(PROTOCOL_ACTIONS, acao) ? act(PROTOCOL_ACTIONS[acao], question) : { erro: `Ação inválida. Use: ${Object.keys(PROTOCOL_ACTIONS).join(', ')}.` }) },
    { name: 'mostrar_no_visor', action: true, status: 'mudando o visor…',
      description: 'Ação: põe na tela do visor uma ou mais leituras em número (ficam fixas e se atualizam sozinhas) ou liga um painel. Para uma camada colorida sobre o terreno, use camada_no_visor. Use quando o astronauta pedir para mostrar, colocar, fixar ou trocar o que aparece no visor, por exemplo "me mostra meu oxigênio", "coloca na tela a velocidade média", "altera o visor para mostrar a radiação", "abre o mapa".',
      parameters: { type: 'object', required: ['itens'], properties: { itens: { type: 'array', items: { type: 'string', enum: [...Object.keys(METRICS), ...HUD_PANELS] }, description: 'Leituras ou painéis a mostrar.' } } },
      run: ({ itens } = {}, { question }) => changeHud(itens, true, question) },
    { name: 'camada_no_visor', action: true, status: 'pintando o terreno…',
      description: 'Ação: pinta sobre o terreno do visor uma camada do mapa do tablet, como se vê no painel de planejamento: termico (temperatura do terreno à noite), declive, radio, radiacao, volta_a_pe ou areia; "nenhuma" volta à imagem normal. Use quando pedirem para VER NO TERRENO, ver a camada, o mapa de temperatura, de declive, de rádio, de radiação ou de areia.',
      parameters: { type: 'object', required: ['camada'], properties: { camada: { type: 'string', enum: Object.keys(VISOR_LAYERS) } } },
      run: ({ camada } = {}, { question }) => changeLayer(camada, question) },
    { name: 'tirar_do_visor', action: true, status: 'mudando o visor…',
      description: 'Ação: tira da tela do visor uma leitura fixada ou desliga um painel (mapa, leituras, historico). "tudo" tira todas as leituras fixadas. Alertas, protocolo e o quadro de volta a pé não saem: são de segurança.',
      parameters: { type: 'object', required: ['itens'], properties: { itens: { type: 'array', items: { type: 'string', enum: [...Object.keys(METRICS), ...HUD_PANELS, 'tudo'] }, description: 'Leituras ou painéis a tirar.' } } },
      run: ({ itens } = {}, { question }) => changeHud(itens, false, question) },
    { name: 'pausar', action: true, status: 'ajustando a caminhada…',
      description: 'Ação: pausa ou retoma a caminhada da saída. Só com ordem direta do astronauta.',
      parameters: { type: 'object', required: ['pausar'], properties: { pausar: { type: 'boolean', description: 'true para pausar, false para retomar.' } } },
      run: ({ pausar } = {}, { question }) => act({ type: pausar === false || pausar === 'false' ? 'resume' : 'pause' }, question) },
  ]);

  return Object.freeze({ tools, snapshot, retrieve: createRetriever(), pins, clearPins: () => { pinned = []; visorLayer = 'nenhuma'; } });
}
