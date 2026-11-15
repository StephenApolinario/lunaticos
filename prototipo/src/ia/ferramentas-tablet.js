// Ferramentas que a IA usa no tablet de planejamento. Os dados de agora são o plano que está na
// tela, a hora de partida com o Sol e o ambiente medido; as ferramentas de ação mudam o plano na
// tela (hora, modo, pontos da rota, camada do mapa), sempre a pedido direto da tripulação.
//
// Puro: recebe tudo por parâmetro.

import { fmtClock, fmtDistance, fmtDuration, fmtKm, fmtNumber } from '../format.js';
import { ORIGIN, toLocal, toGeo } from '../geo.js';
import { sunAt, daylightHours, localSolarHour, compassName, EARTH_HOURS_PER_MARS_HOUR } from '../luz.js';
import { coldSpan, estimatedAirTempC, estimatedGroundTempC } from '../clima.js';
import { shortName } from '../route.js';
import { TRAVEL } from '../pathfind.js';
import { LAYERS } from '../config.js';
import { STOPS, STOP_HOURS } from '../../data/travessia.js';
import { OPPORTUNITIES, trackPositionAtSol } from '../../data/oportunidades.js';
import { RAD, REMS } from '../../data/medicoes.js';
import { SUIT, O2_PCT_PER_HOUR, O2_RESERVE_PCT, SUIT_ORIGIN, SPEED_ORIGIN } from '../../data/traje.js';
import { createKnowledgeTools, createRetriever, createRoverTrips, describeSite, isOrder, MISSION_BRIEF, NOT_AN_ORDER, roverInfo, tripSummary, VEHICLE_INFO } from './ferramentas-comuns.js';
import { BASE_RULES } from './agente.js';
import { t } from '../i18n.js';

export const TABLET_PROMPT = `Você é a IA de planejamento do tablet do habitat, na cratera Gale, em Marte. A tripulação monta aqui a saída antes de vestir o traje. DADOS DE AGORA traz o plano que está na tela (rota, paradas, tempo e segurança), a hora de partida com o Sol e a luz, e o ambiente medido. As ferramentas trazem a ciência das paradas, os protocolos, as fontes pesquisadas, a calculadora e a análise de um ponto do mapa. As ferramentas de ação mudam o plano na tela.

${MISSION_BRIEF}

${BASE_RULES}`;

/** Pedidos de exemplo para os botões do painel: [rótulo, pedido]. */
export const TABLET_EXAMPLES = Object.freeze([
  [t('Esse plano é seguro?'), t('O plano que está na tela é seguro? Onde está o maior risco?')],
  [t('Dá tempo com luz?'), t('Saindo nesta hora, a saída termina antes do pôr do Sol?')],
  [t('Sair às 8h'), t('Muda a hora de partida para as 8h.')],
  [t('Onde falta rádio?'), t('Mostra no mapa onde a rota fica sem rádio.')],
  [t('Rota até o enxofre'), t('Monta uma rota livre até a parada 3, a do enxofre.')],
  [t('De onde vem o relevo?'), t('De onde vem o dado de relevo do mapa?')],
]);

const LAYER_NAMES = Object.freeze({ none: 'relevo e imagem', slope: 'declividade', walkback: 'volta a pé', comms: 'rádio', radiation: 'radiação', thermal: 'térmico', sand: 'areia fofa (estimada)' });
const MODES = Object.freeze({ a_pe: 'walk', veiculo: 'car' });
const HOUR_STEP = 0.25;
const noParams = Object.freeze({ type: 'object', properties: {} });
const pct = (value) => `${fmtNumber(value)}%`;
const plain = (value, digits = 0) => value.toFixed(digits).replace('.', ',');

/**
 * @param {{
 *   getState: () => { hourH: number, mode: string, layer: string, waypoints: ReadonlyArray<object>, weather?: object | null, dose?: object | null, notice?: string | null },
 *   getPlan: () => object,
 *   safety: { walkBackAt: Function, commsAt: Function, radiationAt: Function },
 *   terrain: { heightAt: (x: number, z: number) => number, probe: (x: number, z: number) => { slopeDeg: number } },
 *   lsDeg: number,
 *   isInsideData: (point: { x: number, z: number }) => boolean,
 *   actions: { setHour: (hourH: number) => void, setMode: (mode: 'walk'|'car') => void, addWaypoint: (point: { x: number, z: number }) => void,
 *     removeWaypoint: (index: number) => void, clearRoute: () => void, setLayer: (layer: string) => void, focusStop: (stop: object) => void },
 * }} deps
 * @returns {{ tools: ReadonlyArray<object>, snapshot: () => object }}
 */
export function createTabletTools({ getState, getPlan, safety, terrain, lsDeg, isInsideData, actions, rover = () => null, planIn = null, tripTo = null }) {
  const roverTrips = createRoverTrips(tripTo);
  const { sunriseH, sunsetH } = daylightHours(ORIGIN.lat, lsDeg);
  const knownStops = () => {
    const planned = getPlan().stops.map((entry) => ({ ...entry.stop, inPlan: true }));
    return [...planned, ...STOPS.filter((stop) => !planned.some((entry) => entry.id === stop.id)).map((stop) => ({ ...stop, inPlan: stop.id === 'H' }))];
  };
  const knowledge = createKnowledgeTools({
    stops: knownStops,
    focusStop: () => knownStops()[0],
    siteOf: (stop) => describeSite(toLocal(stop.lat, stop.lon), { safety, terrain }),
  });

  function plano() {
    const plan = getPlan();
    const { safety: assessed, path } = plan;
    const footH = path.totalFootH + plan.stops.length * STOP_HOURS;
    const o2EndPct = 100 - O2_PCT_PER_HOUR.foot * footH - O2_PCT_PER_HOUR.cabin * (path.totalTravelH - path.totalFootH);
    return {
      tipo: plan.isCustom ? 'rota livre com pontos escolhidos no mapa' : `travessia do Monte Sharp${plan.includeExtension ? ', com a extensão até os boxworks' : ''}`,
      deslocamento: plan.mode === 'walk' ? 'a pé' : 'de veículo',
      distancia_total: fmtKm(plan.stats.totalKm),
      duracao_prevista: fmtDuration(plan.stats.hours),
      subida_acumulada_na_ida: `${plain(plan.stats.gainM)} m`,
      maior_declive: `${fmtNumber(plan.stats.maxSlopeDeg, 1)}°`,
      paradas: plan.stops.map(({ stop, distM }) => ({ id: stop.id, nome: stop.name, distancia_na_rota: fmtDistance(distM) })),
      trechos: [...plan.legs, plan.returnLeg].map((leg) => ({
        de: shortName(leg.from), para: shortName(leg.to), distancia: fmtKm(leg.len_km), subida: `${plain(leg.gain_m)} m`,
        maior_declive: `${fmtNumber(leg.max_slope, 1)}°`, veiculo_nao_passa: leg.blocked ? 'sim: trecho feito a pé' : undefined,
      })),
      seguranca: {
        oxigenio_ao_fim_da_saida: `${pct(o2EndPct)} (reserva mínima: ${pct(O2_RESERVE_PCT)})`,
        volta_a_pe: assessed.noReturn
          ? `a partir de ${fmtKm(assessed.noReturn.distM / 1000)} de rota, ${assessed.noReturn.noWalkRoute ? 'não há caminho a pé até o habitat dentro do limite de declive' : 'o oxigênio não cobre mais a volta a pé ao habitat'}`
          : 'o oxigênio cobre a volta a pé ao habitat de qualquer ponto da rota',
        menor_folga_de_oxigenio: assessed.minMarginH === null ? undefined : fmtDuration(assessed.minMarginH),
        radio: assessed.commsLostM > 0
          ? `${fmtKm(assessed.commsLostM / 1000)} da rota sem linha de visada com o habitat, em ${assessed.commsGaps.length} trecho(s)`
          : 'toda a rota tem linha de visada com o habitat',
        ponto_mais_afastado: assessed.farthest ? `${fmtDuration(assessed.farthest.walkH)} a pé do habitat` : undefined,
        protecao_de_relevo_no_ponto_mais_afastado: assessed.shelter?.terrain
          ? `a ${fmtDistance(assessed.shelter.terrain.distM)}; a encosta tapa ${pct(assessed.shelter.terrain.skyBlocked * 100)} do céu`
          : 'nenhuma a menos de 1,5 km',
      },
      origem: `rotas, volta a pé, rádio e abrigo calculados sobre o relevo real (modelo de elevação do USGS). ${SPEED_ORIGIN} Oxigênio: ${SUIT_ORIGIN}`,
    };
  }

  // Avaliação do plano, calculada aqui e não deixada para o modelo: o que pesa mais vem primeiro.
  function pontosDeAtencao() {
    const plan = getPlan();
    const { safety: assessed, path, stats } = plan;
    const light = daylightAt(getState().hourH);
    const footH = path.totalFootH + plan.stops.length * STOP_HOURS;
    const o2EndPct = 100 - O2_PCT_PER_HOUR.foot * footH - O2_PCT_PER_HOUR.cabin * (path.totalTravelH - path.totalFootH);
    const lostShare = path.totalM > 0 ? (assessed.commsLostM / path.totalM) * 100 : 0;
    const slopeLimit = TRAVEL[plan.mode].maxSlopeDeg;
    const items = [];
    const add = (gravidade, texto) => items.push({ gravidade, texto });
    if (!light.isDay) add('alta', 'a saída começaria no escuro');
    else if (light.spareH < 0) add('alta', `a saída termina ${fmtDuration(-light.spareH)} depois do pôr do Sol, já no escuro`);
    else if (light.spareH < 1) add('média', `a saída termina só ${fmtDuration(light.spareH)} antes do pôr do Sol`);
    if (o2EndPct < O2_RESERVE_PCT) add('alta', `o oxigênio termina em ${pct(o2EndPct)}, abaixo da reserva mínima de ${pct(O2_RESERVE_PCT)}`);
    if (assessed.noReturn) add('alta', `a partir de ${fmtKm(assessed.noReturn.distM / 1000)} de rota não dá mais para voltar a pé ao habitat`);
    if (lostShare > 50) add('alta', `${pct(lostShare)} da rota fica sem rádio direto com o habitat`);
    else if (lostShare > 0) add('média', `${pct(lostShare)} da rota fica sem rádio direto com o habitat`);
    const startH = getState().hourH;
    const endH = localSolarHour(startH, stats.hours);
    const chill = coldSpan(startH, endH, SUIT.minTempC);
    // `lastH` é a última hora fria dentro da saída: se encosta no fim, o frio continua depois dela.
    const chillUntil = chill && endH - chill.lastH < 0.1 ? 'até o fim da saída' : `às ${fmtClock(chill?.lastH ?? 0)}`;
    if (chill) add('alta', `das ${fmtClock(chill.firstH)} ${chillUntil} o ar fica abaixo do mínimo de ${SUIT.minTempC} °C do traje (limite que é hipótese da equipe), chegando a cerca de ${fmtNumber(chill.coldestC)} °C: o aquecimento gasta mais bateria`);
    if (stats.maxSlopeDeg >= slopeLimit - 2) add('média', `maior declive de ${fmtNumber(stats.maxSlopeDeg, 1)}°, perto do limite de ${slopeLimit}° deste deslocamento`);
    if (assessed.sandM > 0) add('média', `${fmtDistance(assessed.sandM)} da rota passam por areia escura (estimada pela cor da imagem): a pé cansa mais e de veículo há risco de atolar`);
    if (stats.blockedLegs.length > 0) add('média', `${stats.blockedLegs.length} trecho(s) em que o veículo não passa e a tripulação segue a pé`);
    const order = ['alta', 'média'];
    return items.length === 0 ? 'nenhum: o plano cabe na luz do dia, no oxigênio, no rádio e no declive' : items.sort((a, b) => order.indexOf(a.gravidade) - order.indexOf(b.gravidade));
  }

  // Luz do dia para uma hora de partida, com o plano que está na tela.
  function daylightAt(hourH) {
    const endH = localSolarHour(hourH, getPlan().stats.hours);
    return { isDay: hourH >= sunriseH && hourH < sunsetH, endH, spareH: (sunsetH - endH) * EARTH_HOURS_PER_MARS_HOUR };
  }

  function partidaELuz(hourH = getState().hourH) {
    const sun = sunAt(ORIGIN.lat, lsDeg, hourH);
    const { isDay, endH, spareH } = daylightAt(hourH);
    let daylight = `dá tempo: a saída termina ${fmtDuration(spareH)} antes do pôr do Sol`;
    if (!isDay) daylight = 'a saída começaria no escuro';
    else if (spareH < 0) daylight = `não dá tempo: a saída termina ${fmtDuration(-spareH)} depois do pôr do Sol, já no escuro`;
    return {
      hora_de_partida: fmtClock(hourH),
      sol_na_partida: isDay ? `${fmtNumber(sun.elevationDeg)}° de altura, a ${compassName(sun.azimuthDeg)}` : 'abaixo do horizonte',
      nascer_do_sol: fmtClock(sunriseH),
      por_do_sol: fmtClock(sunsetH),
      fim_previsto_da_saida: fmtClock(endH),
      luz_do_dia: daylight,
      origem: 'calculado pelo algoritmo Mars24 da NASA para a estação de hoje em Marte; não conta a poeira',
    };
  }

  function ambiente() {
    const { hourH, weather, dose } = getState();
    return {
      temperatura_na_partida: `ar ${fmtNumber(estimatedAirTempC(hourH))} °C e solo ${fmtNumber(estimatedGroundTempC(hourH))} °C (estimado para a hora de partida entre a mínima e a máxima medidas)`,
      faixa_medida: weather
        ? `ar de ${fmtNumber(weather.air.minC)} a ${fmtNumber(weather.air.maxC)} °C e solo de ${fmtNumber(weather.ground.minC)} a ${fmtNumber(weather.ground.maxC)} °C, pressão de ${plain(weather.pressurePa)} Pa: média de ${weather.sols} sols desta estação medidos pelo REMS do Curiosity`
        : `ar de ${REMS.air.minC} a ${REMS.air.maxC} °C e solo de ${REMS.ground.minC} a ${REMS.ground.maxC} °C em um sol típico de 2012, medido pelo REMS (valor de reserva, sem rede)`,
      radiacao: {
        taxa_usada: `${fmtNumber(RAD.surfaceUsvPerHour, 1)} µSv/h (medido: média do RAD do Curiosity em Gale, ${String(RAD.surfaceMsvPerDay).replace('.', ',')} mSv por dia)`,
        medicao_recente_do_rad: dose
          ? `${fmtNumber(dose.ugyPerDay)} µGy por dia de dose absorvida, média de ${dose.days} dias até ${dose.until.toLocaleDateString('pt-BR', { timeZone: 'UTC' })} (medido, lido do NASA CCMC)`
          : 'indisponível agora (sem rede)',
      },
      vento: 'sem medição: o sensor de vento do REMS parou no sol 1491',
    };
  }

  const snapshot = () => ({
    pontos_de_atencao_do_plano: pontosDeAtencao(), plano: plano(), partida_e_luz: partidaELuz(), ambiente: ambiente(),
    veiculo_da_saida: VEHICLE_INFO,
    rover_curiosity: roverInfo(rover(), { ...safety.habitat, label: 'do habitat' }, { safety, terrain, trips: roverTrips(rover()) }),
    tela: { camada_no_mapa: LAYER_NAMES[getState().layer] ?? getState().layer },
  });

  // Ponto pedido pelo modelo: uma parada, um caso de coleta do rover ou latitude e longitude.
  function resolvePoint({ parada_id: stopId, coleta, latitude, longitude, rover: wantsRover } = {}) {
    // O rover Curiosity vale como destino: a posição é a publicada pela NASA.
    const current = rover();
    if (current && (wantsRover === true || wantsRover === 'true' || /rover|curiosity|hover/i.test(String(coleta ?? '')))) {
      return { ...toLocal(current.lat, current.lon), name: `rover Curiosity (posição publicada pela NASA no sol ${current.sol})` };
    }
    const hasStop = stopId !== undefined && stopId !== null && String(stopId).trim() !== '';
    if (coleta && String(coleta).trim()) {
      const wanted = String(coleta).trim().toLowerCase();
      const item = OPPORTUNITIES.find((candidate) => candidate.id === wanted || candidate.name.toLowerCase().includes(wanted));
      if (item) {
        const position = trackPositionAtSol(item.sol);
        return { ...toLocal(position.lat, position.lon), name: `local da coleta ${item.name} (posição do rover no sol ${position.sol})` };
      }
      // O modelo às vezes manda o nome da parada neste campo: se veio também a parada, vale ela.
      if (!hasStop) return { erro: `Não há coleta "${coleta}". Casos: ${OPPORTUNITIES.map((candidate) => candidate.name).join(', ')}. Para uma parada, use parada_id.` };
    }
    if (hasStop) {
      const stop = knownStops().find((candidate) => String(candidate.id).toUpperCase() === String(stopId).trim().toUpperCase());
      return stop ? { ...toLocal(stop.lat, stop.lon), name: `parada ${stop.id}, ${stop.name}` } : { erro: `Não há parada "${stopId}".` };
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { erro: 'Diga uma parada (parada_id), uma coleta do rover ou latitude e longitude.' };
    return { ...toLocal(lat, lon), name: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
  }

  function pontoNoMapa(args) {
    const point = resolvePoint(args);
    if (point.erro) return point;
    if (!isInsideData(point)) return { erro: 'Esse ponto fica fora da área com dados do mapa.' };
    const { lat, lon } = toGeo(point.x, point.z);
    return { local: point.name, latitude: lat.toFixed(5), longitude: lon.toFixed(5), ...describeSite(point, { safety, terrain }) };
  }

  // Executa uma ação só com ordem direta e devolve o plano como ficou, para a IA contar o resultado.
  const act = (question, change, what = undefined) => {
    if (!isOrder(question)) return NOT_AN_ORDER;
    const before = getState().notice;
    change();
    const { notice } = getState();
    if (notice && notice !== before) return { erro: `O plano não mudou: ${notice}` };
    return { feito: true, o_que_mudou: what, como_ficou: snapshot() };
  };

  const tools = Object.freeze([
    ...knowledge,
    { name: 'simular_deslocamento', status: t('simulando o trajeto…'),
      description: 'Simulação, sem mudar o plano da tela: como fica este mesmo plano, com as paradas de coleta, feito de veículo ou a pé: distância, duração total, tempo nas paradas, oxigênio gasto e trechos em que o veículo não passa. Traz também os dados do veículo. Use para "e se formos de jipe", "quanto tempo levo de veículo parando para coletar".',
      parameters: { type: 'object', required: ['modo'], properties: { modo: { type: 'string', enum: ['veiculo', 'a_pe'], description: 'veiculo ou a_pe.' } } },
      run: ({ modo } = {}) => {
        if (modo !== 'veiculo' && modo !== 'a_pe') return { erro: 'Modo inválido. Use: veiculo ou a_pe.' };
        const simulated = planIn?.(modo === 'veiculo' ? 'car' : 'walk');
        if (!simulated) return { erro: 'Não consegui calcular este plano nesse modo.' };
        return { plano_da_tela: tripSummary(getPlan()), plano_simulado: tripSummary(simulated), veiculo: VEHICLE_INFO, aviso: 'Simulação: o plano da tela não foi alterado.' };
      } },
    { name: 'analisar_local', status: t('analisando o local…'), run: pontoNoMapa,
      description: 'Terreno e segurança de um local, sem mudar o plano: altitude, declive, tempo de volta a pé ao habitat, se há rádio com o habitat e a radiação estimada. Use para perguntas sobre o terreno, o rádio ou a volta a pé em uma parada, em uma coleta do rover ou em uma latitude e longitude. (A ciência da parada é a ferramenta parada.)',
      parameters: { type: 'object', properties: { parada_id: { type: 'string', description: 'H, 1, 2, 3, 4, 5 ou a letra de um ponto da rota livre.' }, coleta: { type: 'string', description: 'Nome de um caso de coleta do rover, por exemplo "Atacama".' }, latitude: { type: 'number' }, longitude: { type: 'number' } } } },
    { name: 'luz_para_outra_hora', status: t('calculando a luz…'),
      description: 'Calcula, sem mudar o plano, como fica a luz do dia se a saída partir em outra hora: Sol na partida, fim previsto e quanto sobra de luz. Use para perguntas do tipo "e se eu sair às 15h?".',
      parameters: { type: 'object', required: ['hora'], properties: { hora: { type: 'number', description: 'Hora de 0 a 23,75. Por exemplo 15 para 15:00.' } } },
      run: ({ hora } = {}) => {
        const hourH = Number(hora);
        return Number.isFinite(hourH) && hourH >= 0 && hourH < 24
          ? { aviso: 'Simulação: o plano na tela não mudou. Responda só com os valores abaixo.', se_a_saida_partir_nessa_hora: partidaELuz(hourH) }
          : { erro: 'Hora inválida: use de 0 a 23,75.' };
      } },
    { name: 'definir_hora', action: true, status: t('mudando a hora de partida…'),
      description: 'Ação: muda a hora solar local de partida da saída. O Sol, as sombras e a folga de luz são refeitos.',
      parameters: { type: 'object', required: ['hora'], properties: { hora: { type: 'number', description: 'Hora de 0 a 23,75. Por exemplo 8 para 08:00 e 14.5 para 14:30.' } } },
      run: ({ hora } = {}, { question }) => {
        const hourH = Math.round(Number(hora) / HOUR_STEP) * HOUR_STEP;
        if (!Number.isFinite(hourH) || hourH < 0 || hourH >= 24) return { erro: 'Hora inválida: use de 0 a 23,75.' };
        return act(question, () => actions.setHour(hourH));
      } },
    { name: 'definir_modo', action: true, status: t('mudando o deslocamento…'),
      description: 'Ação: muda o deslocamento da saída para a pé ou de veículo e refaz o plano.',
      parameters: { type: 'object', required: ['modo'], properties: { modo: { type: 'string', enum: Object.keys(MODES) } } },
      run: ({ modo } = {}, { question }) => (Object.hasOwn(MODES, modo) ? act(question, () => actions.setMode(MODES[modo])) : { erro: 'Modo inválido: use a_pe ou veiculo.' }) },
    { name: 'adicionar_ponto', action: true, status: t('acrescentando o ponto à rota…'),
      description: 'Ação: acrescenta um ponto ao fim da rota livre (vira a próxima parada A, B, C…) e recalcula a rota sobre o relevo. O primeiro ponto troca a travessia do Monte Sharp por uma rota livre.',
      parameters: { type: 'object', properties: { parada_id: { type: 'string', description: 'Parada da travessia: 1, 2, 3, 4 ou 5.' }, coleta: { type: 'string', description: 'Caso de coleta do rover, por exemplo "Atacama".' }, rover: { type: 'boolean', description: 'true para o local onde está o rover Curiosity.' }, latitude: { type: 'number' }, longitude: { type: 'number' } } },
      run: (args, { question }) => {
        const point = resolvePoint(args);
        if (point.erro) return point;
        if (!isInsideData(point)) return { erro: 'Esse ponto fica fora da área com dados do mapa.' };
        return act(question, () => actions.addWaypoint({ x: point.x, z: point.z }), `acrescentado à rota: ${point.name}`);
      } },
    { name: 'remover_ponto', action: true, status: t('tirando o ponto da rota…'),
      description: 'Ação: tira um ponto da rota livre pela letra (A, B, C…) e recalcula.',
      parameters: { type: 'object', required: ['letra'], properties: { letra: { type: 'string' } } },
      run: ({ letra } = {}, { question }) => {
        const plan = getPlan();
        const index = plan.isCustom ? plan.stops.findIndex((entry) => entry.stop.id === String(letra ?? '').trim().toUpperCase()) : -1;
        return index < 0 ? { erro: `Não há ponto "${letra ?? ''}" na rota livre.` } : act(question, () => actions.removeWaypoint(index));
      } },
    { name: 'voltar_a_travessia', action: true, status: t('voltando à travessia…'), parameters: noParams,
      description: 'Ação: apaga a rota livre e volta ao plano da travessia do Monte Sharp.',
      run: (_args, { question }) => act(question, () => actions.clearRoute()) },
    { name: 'mostrar_camada', action: true, status: t('trocando a camada do mapa…'),
      description: 'Ação: troca a camada mostrada no mapa: none (relevo e imagem), slope (declividade), walkback (tempo de volta a pé), comms (onde há rádio com o habitat), radiation (radiação estimada), thermal (infravermelho térmico noturno).',
      parameters: { type: 'object', required: ['camada'], properties: { camada: { type: 'string', enum: ['none', ...Object.keys(LAYERS), 'slope'].filter((id, i, all) => all.indexOf(id) === i) } } },
      run: ({ camada } = {}, { question }) => (Object.hasOwn(LAYER_NAMES, camada) ? act(question, () => actions.setLayer(camada)) : { erro: `Camada inválida. Use: ${Object.keys(LAYER_NAMES).join(', ')}.` }) },
    { name: 'focar_no_mapa', action: true, status: t('levando o mapa até a parada…'),
      description: 'Ação: leva a câmera do mapa até uma parada.',
      parameters: { type: 'object', required: ['parada_id'], properties: { parada_id: { type: 'string' } } },
      run: ({ parada_id: stopId } = {}, { question }) => {
        const stop = knownStops().find((candidate) => String(candidate.id).toUpperCase() === String(stopId ?? '').trim().toUpperCase());
        return stop ? act(question, () => actions.focusStop(stop)) : { erro: `Não há parada "${stopId ?? ''}".` };
      } },
  ]);

  return Object.freeze({ tools, snapshot, retrieve: createRetriever() });
}
