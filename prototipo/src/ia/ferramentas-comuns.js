// Ferramentas de conhecimento que a IA usa no visor e no tablet: a ciência de uma parada, os
// protocolos de emergência, a busca nas fontes pesquisadas e a calculadora. Puro.

import { fmtDistance, fmtDuration, fmtKm, fmtNumber } from '../format.js';
import { toLocal, yToElev } from '../geo.js';
import { compassName } from '../luz.js';
import { TRAVEL } from '../pathfind.js';
import { shortName } from '../route.js';
import { STOP_HOURS } from '../../data/travessia.js';
import { O2_PCT_PER_HOUR } from '../../data/traje.js';
import { PROTOCOLS } from '../../data/protocolos.js';
import { createFactSearch } from './busca.js';
import { evaluate, formatResult } from './calculo.js';

/**
 * Terreno e segurança em um ponto local (x, z), calculados sobre o relevo real.
 * @param {{ x: number, z: number }} point
 * @param {{ safety: { walkBackAt?: Function, commsAt?: Function, radiationAt?: Function }, terrain: { heightAt: Function, probe: Function } }} deps
 */
export function describeSite(point, { safety, terrain }) {
  const walkH = safety.walkBackAt?.(point.x, point.z);
  const comms = safety.commsAt?.(point.x, point.z);
  const radiation = safety.radiationAt?.(point.x, point.z);
  return {
    altitude: `${yToElev(terrain.heightAt(point.x, point.z)).toFixed(0)} m`,
    declive: `${fmtNumber(terrain.probe(point.x, point.z).slopeDeg)}°`,
    volta_a_pe_ao_habitat: walkH === undefined ? undefined : Number.isFinite(walkH) ? fmtDuration(walkH) : 'sem caminho a pé dentro do limite de declive',
    radio_com_o_habitat: comms ? (comms.visible ? 'com linha de visada' : 'sem linha de visada') : undefined,
    distancia_do_habitat_em_linha_reta: comms ? fmtDistance(comms.distM) : undefined,
    radiacao_estimada: Number.isFinite(radiation) ? `${fmtNumber(radiation, 1)} µSv/h (média do RAD, reduzida pelo céu que o relevo tapa)` : undefined,
    origem: 'calculado sobre o relevo real (modelo de elevação do USGS); as alturas das antenas são hipótese da equipe',
  };
}

/** O que é este projeto e esta saída, para a IA responder com o contexto certo. Vai nos dois prompts. */
export const MISSION_BRIEF = `Contexto do projeto: este é o protótipo Martian Map, da equipe Lunáticos, para o NASA Space Apps Challenge 2026 (desafio "Interplanetary Survival Guide: Martian Map"). A ideia é dar a um astronauta uma visão em camadas, na escala de uma única saída, juntando dados de várias missões da NASA, com a segurança em primeiro lugar: o tablet planeja a saída no habitat e o visor do capacete acompanha a caminhada. A saída de demonstração é a travessia do Monte Sharp, na cratera Gale, pelo caminho que o rover Curiosity percorreu, com paradas científicas onde o rover deixou perguntas em aberto. O local e o objetivo são exemplo da equipe: a missão real ainda não foi definida. O habitat e o veículo da saída são hipóteses da equipe. O relevo, as imagens, as medições e o rover Curiosity são reais.`;

const percent = (value) => `${fmtNumber(value)}%`;

/** O veículo da saída ("jipe"): o que o roteador e o traje assumem sobre ele. */
export const VEHICLE_INFO = Object.freeze({
  o_que_e: 'veículo da saída. É uma hipótese da equipe: o protótipo não modela bateria, autonomia nem carga dele. Nele o astronauta segue de traje e continua gastando o oxigênio do traje',
  velocidade_em_terreno_plano: `${fmtNumber(TRAVEL.car.speedKmh, 1)} km/h de veículo (hipótese da equipe) e ${fmtNumber(TRAVEL.walk.speedKmh)} km/h a pé (valor de planejamento da NASA); o declive reduz as duas`,
  declive_maximo: `${TRAVEL.car.maxSlopeDeg}° de veículo e ${TRAVEL.walk.maxSlopeDeg}° a pé (hipóteses da equipe). Onde o veículo não passa, o trecho é feito a pé`,
  rochas_cortantes: 'o veículo não entra na zona de rochas cortantes',
  oxigenio: `${fmtNumber(O2_PCT_PER_HOUR.cabin, 1)}% do tanque por hora sentado no veículo e ${fmtNumber(O2_PCT_PER_HOUR.foot, 1)}% por hora caminhando (calculado da taxa metabólica medida na Apollo)`,
});

/** Um plano inteiro em números, com as paradas de coleta, para comparar a pé e de veículo. */
export function tripSummary(plan) {
  const stopsH = plan.stops.length * STOP_HOURS;
  const cabinH = plan.path.totalTravelH - plan.path.totalFootH;
  const usedPct = O2_PCT_PER_HOUR.foot * (plan.path.totalFootH + stopsH) + O2_PCT_PER_HOUR.cabin * cabinH;
  const blocked = plan.stats.blockedLegs ?? [];
  return {
    deslocamento: plan.mode === 'walk' ? 'a pé' : 'de veículo',
    distancia_total: fmtKm(plan.stats.totalKm),
    duracao_total_com_as_paradas: fmtDuration(plan.stats.hours),
    tempo_em_deslocamento: fmtDuration(plan.path.totalTravelH),
    tempo_nas_paradas_de_coleta: `${fmtDuration(stopsH)} (${plan.stops.length} paradas de ${fmtNumber(STOP_HOURS * 60)} min cada; o tempo de parada é hipótese da equipe)`,
    tempo_sentado_no_veiculo: cabinH > 0.01 ? fmtDuration(cabinH) : undefined,
    oxigenio_gasto_no_plano: percent(usedPct),
    oxigenio_ao_fim_do_plano: percent(Math.max(0, 100 - usedPct)),
    trechos_feitos_a_pe_porque_o_veiculo_nao_passa: plan.mode === 'walk' ? undefined
      : blocked.length === 0 ? 'nenhum' : blocked.map((leg) => `${shortName(leg.from)} até ${shortName(leg.to)} (${fmtKm(leg.len_km)})`),
    origem: 'calculado: rota sobre o relevo real do USGS, com a velocidade reduzida pelo declive, e o consumo de oxigênio do traje',
  };
}

/**
 * Ida e volta do habitat até o rover, a pé e de veículo, com uma parada no local. A rota é calculada
 * uma vez por posição do rover.
 * @param {((point: { x: number, z: number }, mode: 'walk' | 'car') => { km: number, travelH: number } | null) | null} tripTo
 */
export function createRoverTrips(tripTo) {
  let knownSol = null;
  let trips = null;
  const describe = (point, mode) => {
    const trip = tripTo(point, mode);
    if (!trip) return 'sem rota dentro do limite de declive';
    const usedPct = mode === 'walk'
      ? O2_PCT_PER_HOUR.foot * (trip.travelH + STOP_HOURS)
      : O2_PCT_PER_HOUR.cabin * trip.travelH + O2_PCT_PER_HOUR.foot * STOP_HOURS;
    return {
      distancia: fmtKm(trip.km),
      duracao_com_uma_parada_no_rover: fmtDuration(trip.travelH + STOP_HOURS),
      oxigenio_gasto: percent(usedPct),
      oxigenio_suficiente: usedPct + O2_PCT_PER_HOUR.foot <= 100 ? 'sim, mantendo a reserva de 1 hora' : 'não: gasta mais do que o tanque menos a reserva de 1 hora',
    };
  };
  return (rover) => {
    if (!tripTo || !rover) return null;
    if (rover.sol !== knownSol) {
      const point = toLocal(rover.lat, rover.lon);
      trips = { a_pe: describe(point, 'walk'), de_veiculo: describe(point, 'car'), origem: 'calculado: rota mais segura sobre o relevo real; a parada no rover dura o tempo de uma coleta (hipótese da equipe)' };
      knownSol = rover.sol;
    }
    return trips;
  };
}

/**
 * O rover Curiosity para a IA: onde está (posição publicada pela NASA) e como é o local.
 * @param {{ lat: number, lon: number, elevM: number, sol: number, totalKm: number, live: boolean, readOn?: string } | null} rover
 * @param {{ x: number, z: number, label: string }} from De onde medir a distância ("de onde você está", "do habitat").
 */
export function roverInfo(rover, from, { safety, terrain, trips = null }) {
  if (!rover) return undefined;
  const point = toLocal(rover.lat, rover.lon);
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  // x cresce para leste e z para sul: o azimute sai de (leste, norte).
  const azimuthDeg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return {
    ida_e_volta_desde_o_habitat: trips ?? undefined,
    o_que_e: 'rover Curiosity da NASA (missão MSL): percorre esta região desde 2012 e fez as medições e análises usadas neste mapa. Não é tripulado e não é o veículo da saída',
    posicao: `latitude ${rover.lat.toFixed(5)}, longitude ${rover.lon.toFixed(5)}, altitude ${rover.elevM.toFixed(0)} m, no sol ${rover.sol} da missão dele`,
    distancia_que_ele_ja_andou: fmtKm(rover.totalKm),
    distancia_em_linha_reta: `${fmtDistance(Math.hypot(dx, dz))} ${from.label}, a ${compassName(azimuthDeg)}`,
    local_do_rover: terrain ? describeSite(point, { safety, terrain }) : undefined,
    origem: `medido: posição mais recente publicada pela NASA, ${rover.live ? 'lida agora da rede' : `lida em ${rover.readOn}`}. Nessa data o rover seguia em operação; tratá-lo como parado no fim da missão dele é o cenário da equipe. O rover pesa 899 kg: não dá para trazê-lo, só ir até ele`,
  };
}

// Começos de frase que fazem dela uma pergunta mesmo sem "?": o reconhecimento de voz não pontua.
const ASKS = /^(devo|deveria|posso|podemos|ser[aá] que|[eé] para|[eé] pra|d[aá] para|d[aá] pra|vale a pena|preciso|precisa|tenho que|temos que|conv[eé]m|compensa|como|quando|onde|qual|quais|quanto|quanta|por que|porque|o que|quem|tem como|seria)\b/i;

/** Uma ordem direta ("pausa a caminhada") e não uma pergunta ("devo pausar?", "devo pausar"). */
export function isOrder(question) {
  const text = String(question).trim();
  return !text.endsWith('?') && !ASKS.test(text);
}
export const NOT_AN_ORDER = Object.freeze({ erro: 'O pedido foi uma pergunta, não uma ordem direta. Não execute a ação: responda à pergunta e diga como pedir a ação.' });

const briefFact = (fact) => ({ tema: fact.tema, texto: fact.texto, origem: fact.tipo, fontes: fact.fontes.map((source) => source.label) });
// Busca automática: poucos fatos e só os que casam bem com a pergunta, para não poluir a resposta
// sobre a situação da saída com fato histórico.
const AUTO_FACTS = Object.freeze({ limit: 3, minScore: 3 });

/** @returns {(question: string) => object[]} Os fatos das fontes que entram junto com cada pergunta. */
export function createRetriever() {
  const search = createFactSearch();
  return (question) => search(question, AUTO_FACTS.limit, AUTO_FACTS.minScore).map(briefFact);
}

/**
 * @param {{
 *   stops: () => ReadonlyArray<object>, focusStop: () => object | null | undefined,
 *   samplesAt?: (stopId: string) => number, siteOf?: (stop: object) => object,
 * }} deps `stops` devolve as paradas conhecidas agora (as do plano e as da travessia); `focusStop` a
 *   parada que vale quando o modelo não diz qual; `samplesAt` quantas amostras há registradas nela;
 *   `siteOf` o terreno e a segurança no local da parada (altitude, declive, rádio, volta a pé).
 */
export function createKnowledgeTools({ stops, focusStop, samplesAt = null, siteOf = null }) {
  const search = createFactSearch();

  function parada({ id } = {}) {
    const wanted = String(id ?? '').trim().toUpperCase();
    const known = stops();
    const stop = wanted ? known.find((candidate) => String(candidate.id).toUpperCase() === wanted) : focusStop();
    if (!stop) return { erro: `Não há parada "${id ?? ''}". Paradas: ${known.map((candidate) => `${candidate.id} (${candidate.name})`).join(', ')}.` };
    return {
      id: stop.id, nome: stop.name, sol_em_que_o_curiosity_passou: stop.sol ?? undefined,
      no_plano_desta_saida: stop.inPlan === undefined ? undefined : stop.inPlan ? 'sim' : 'não',
      ciencia: [stop.sci, stop.imp, stop.int].filter(Boolean).join(' '),
      pergunta_cientifica: stop.q, tarefa: stop.task, risco_do_local: stop.risk ?? 'nenhum anotado',
      amostras_registradas_aqui: samplesAt ? samplesAt(stop.id) : undefined,
      terreno_e_seguranca_no_local: siteOf ? siteOf(stop) : undefined,
      origem: stop.sources?.length
        ? `ciência: fatos publicados (${stop.sources.map((source) => source.label).join('; ')}); pergunta e tarefa: roteiro da equipe`
        : 'ponto escolhido pela tripulação no mapa; pergunta e tarefa são roteiro da equipe',
    };
  }

  function protocolo({ cenario } = {}) {
    const wanted = String(cenario ?? '').trim().toLowerCase();
    const protocol = PROTOCOLS.find((candidate) => candidate.id === wanted);
    if (!protocol) return { erro: `Cenário desconhecido. Use um destes: ${PROTOCOLS.map((candidate) => candidate.id).join(', ')}.` };
    return {
      nome: protocol.title, quando_vale: protocol.trigger, passos: protocol.steps,
      fatos_que_sustentam: protocol.evidence.map((fact) => `${fact.text} (${fact.label})`),
      origem: 'os passos são proposta da equipe, não procedimento oficial da NASA; os fatos são de missões reais',
    };
  }

  function buscarFatos({ consulta } = {}) {
    const facts = search(String(consulta ?? ''));
    if (facts.length === 0) return { fatos: [], aviso: 'Nada nas fontes da missão sobre isso. Diga que esse dado não está disponível.' };
    return { fatos: facts.map(briefFact) };
  }

  const calcular = ({ expressao } = {}) => ({ expressao: String(expressao ?? ''), resultado: formatResult(evaluate(expressao)) });

  return Object.freeze([
    { name: 'parada', status: 'lendo a parada…', run: parada,
      description: 'Tudo sobre uma parada científica do plano (não serve para achar onde descansar: isso está em pontos_para_parar): a ciência (o que há ali, por que importa, pergunta científica, tarefa de coleta, risco, fontes) e o local (altitude, declive, rádio com o habitat, volta a pé, radiação estimada). Sem id, devolve a parada atual ou a próxima.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Identificador da parada: H, 1, 2, 3, 4, 5 ou a letra de um ponto da rota livre.' } } } },
    { name: 'protocolo', status: 'lendo o protocolo…', run: protocolo,
      description: 'O que fazer em um cenário de perigo: passos do protocolo e os fatos de missões reais que o sustentam.',
      parameters: { type: 'object', required: ['cenario'], properties: { cenario: { type: 'string', enum: PROTOCOLS.map((candidate) => candidate.id), description: 'tempestade (poeira), evento-solar (radiação), temperatura (frio), vento, radio (sem rádio), pane-veiculo, oxigenio (O₂ baixo ou vazamento), atolamento.' } } } },
    { name: 'buscar_fatos', status: 'buscando nas fontes…', run: buscarFatos,
      description: 'Busca nas fontes pesquisadas da missão: lições de missões passadas (Apollo, Spirit, Opportunity, Curiosity), números do ambiente em Gale, trajes, coletas do rover, e de onde vem cada dado do protótipo. Use para perguntas de conhecimento e de origem dos dados.',
      parameters: { type: 'object', required: ['consulta'], properties: { consulta: { type: 'string', description: 'Palavras-chave em português, por exemplo "evento solar 2024 dose" ou "de onde vem a temperatura".' } } } },
    { name: 'calcular', status: 'calculando…', run: calcular,
      description: 'Faz uma conta com números que vieram dos dados. Aceita + - * / e parênteses.',
      parameters: { type: 'object', required: ['expressao'], properties: { expressao: { type: 'string', description: 'Por exemplo "4,7 - 2,4" ou "(71 - 10) / 12,5".' } } } },
  ]);
}
