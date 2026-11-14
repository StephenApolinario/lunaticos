// Painel de planejamento do modo tablet: modo de deslocamento, camadas,
// resumo da rota, trechos, paradas científicas e perfil de altitude.

import { STOPS, SPEED_KMH, STOP_HOURS } from '../data/travessia.js';
import { shortName } from './route.js';
import { fmtKm, fmtDuration, fmtDistance, fmtNumber } from './format.js';
import { ROUTE_OPTIONS } from './planner.js';
import { ASSUMPTIONS } from './safety.js';
import { PROTOCOLS, SHELTER_KINDS } from '../data/protocolos.js';
import { OPPORTUNITIES, trackPositionAtSol } from '../data/oportunidades.js';
import { LAYERS, SLOPE_CLASSES } from './config.js';
import { h, svg } from './dom.js';

const LAYER_OPTIONS = Object.freeze([
  { id: 'none', label: 'Relevo' },
  { id: 'slope', label: 'Declividade' },
  { id: 'walkback', label: 'Volta a pé' },
  { id: 'comms', label: 'Rádio' },
  { id: 'radiation', label: 'Radiação' },
  { id: 'temperature', label: 'Temperatura' },
]);
const SLOPE_LIMIT_DEG = Object.freeze({ walk: 20, car: 15 });
const PROFILE = Object.freeze({ width: 380, height: 150, left: 40, right: 10, top: 12, bottom: 22, gridStepM: 100 });
const STOP_MINUTES = STOP_HOURS * 60;

function buildHeader(handlers, options) {
  return h('header', { class: 'panel-header' },
    h('p', { class: 'eyebrow' }, 'Cratera Gale · Monte Sharp · Marte'),
    h('h1', {}, 'Das argilas ao enxofre'),
    h('p', { class: 'lede' }, 'Rota de exploração humana calculada sobre o relevo real, ao lado do trajeto do Curiosity (2019–2026). Planeje aqui e siga a rota pelo visor do capacete.'),
    h('div', { class: 'mission' },
      h('p', { class: 'eyebrow' }, 'Objetivo da missão'),
      h('p', {}, h('strong', {}, 'Seguir a água do Monte Sharp: '), 'reconstruir quando e como Marte perdeu a água líquida, e trazer as amostras com mais chance de guardar sinais de vida.'),
    ),
    h('button', { class: 'cta', type: 'button', onclick: handlers.onEnterVisor },
      h('span', {}, 'Entrar no visor do capacete'),
      h('span', { class: 'cta-arrow', 'aria-hidden': 'true' }, '→'),
    ),
    h('label', { class: 'visor-pick' }, 'Variante do visor',
      h('select', { onchange: (event) => handlers.onVisorChange(event.target.value) },
        options.visors.map((visor) => h('option', { value: visor.id, selected: visor.id === options.visorId }, visor.name)),
      ),
    ),
  );
}

function buildModeControls(handlers) {
  const walk = h('button', { type: 'button', onclick: () => handlers.onModeChange('walk') }, 'A pé');
  const car = h('button', { type: 'button', onclick: () => handlers.onModeChange('car') }, 'Veículo');
  const extension = h('input', { type: 'checkbox', onchange: (event) => handlers.onExtensionChange(event.target.checked) });
  const extensionLabel = h('label', { class: 'opt' }, extension, 'Incluir extensão até os boxworks');
  const node = h('section', { 'aria-label': 'Modo de deslocamento' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo' }, walk, car),
    extensionLabel,
  );
  const sync = (state) => {
    walk.setAttribute('aria-pressed', String(state.mode === 'walk'));
    car.setAttribute('aria-pressed', String(state.mode === 'car'));
    extension.checked = state.includeExtension;
    // A extensão é da travessia pré-calculada: não se aplica a um destino livre.
    extension.disabled = Boolean(state.destination);
    extensionLabel.dataset.disabled = String(Boolean(state.destination));
  };
  return { node, sync };
}

const LEGEND_NOTES = Object.freeze({
  photoRealRelief: 'Imagem HiRISE e relevo reais. A altura vem do modelo de elevação de 1 m do USGS, em grade de 8 m.',
  photo: 'Imagem HiRISE real. A altura do relevo é aproximada: fiel ao longo das rotas, suavizada entre elas.',
  proceduralRealRelief: 'Relevo real (USGS). A cor do solo é ilustrativa: a imagem não está carregada.',
  procedural: 'Cor do solo ilustrativa. O relevo é aproximado, ancorado nas altitudes reais das rotas.',
  slopeReal: 'Declive real, calculado sobre o modelo de elevação de 1 m do USGS.',
  slopeIllustrative: 'Declive do relevo ilustrativo: a imagem real não está carregada.',
});

function reliefNote(hasPhoto, realRelief) {
  if (hasPhoto) return realRelief ? LEGEND_NOTES.photoRealRelief : LEGEND_NOTES.photo;
  return realRelief ? LEGEND_NOTES.proceduralRealRelief : LEGEND_NOTES.procedural;
}

function layerLegend(layer, hasPhoto, realRelief) {
  if (layer === 'slope') {
    return [
      ...[...SLOPE_CLASSES].reverse().map((entry) =>
        h('span', { class: 'swatch' }, h('i', { style: `background:${entry.color}` }), entry.label)),
      h('span', { class: 'note' }, hasPhoto ? LEGEND_NOTES.slopeReal : LEGEND_NOTES.slopeIllustrative),
    ];
  }
  const spec = LAYERS[layer];
  if (!spec) return [h('span', { class: 'note' }, reliefNote(hasPhoto, realRelief))];
  return [
    h('span', { class: 'ramp-label' }, spec.minLabel ?? `${spec.min} ${spec.unit}`),
    h('i', { class: 'ramp', style: `background:linear-gradient(90deg, ${spec.ramp.join(', ')})` }),
    h('span', { class: 'ramp-label' }, spec.maxLabel ?? `${spec.max} ${spec.unit}`),
    h('span', { class: spec.simulated ? 'note simulated' : 'note' }, spec.note),
  ];
}

function buildLayerControls(handlers) {
  const buttons = LAYER_OPTIONS.map((option) => ({
    id: option.id,
    node: h('button', { type: 'button', onclick: () => handlers.onLayerChange(option.id) }, option.label),
  }));
  const legend = h('div', { class: 'layer-legend' });
  const node = h('section', {},
    h('h2', {}, 'Camadas do mapa'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Camada exibida' }, buttons.map((button) => button.node)),
    legend,
  );
  const sync = (state) => {
    buttons.forEach((button) => button.node.setAttribute('aria-pressed', String(button.id === state.layer)));
    legend.replaceChildren(...layerLegend(state.layer, state.imagery === 'ready', state.relief === 'real'));
  };
  return { node, sync };
}

const CUSTOM_ROUTE_NOTE = ' Rota calculada no navegador sobre a grade de 8 m: blocos e cristas menores que isso não aparecem, então ela é mais grosseira que as pré-calculadas em 2 m.';

function assumptionNote(plan) {
  return baseAssumptionNote(plan) + (plan.isCustom ? CUSTOM_ROUTE_NOTE : '');
}

function baseAssumptionNote(plan) {
  const { mode, stats } = plan;
  if (mode === 'walk') {
    return `Estimativa: ${fmtNumber(SPEED_KMH.walk, 1)} km/h com traje e carga, ${STOP_MINUTES} min por parada. Rota evita declives acima de ${SLOPE_LIMIT_DEG.walk}°.`;
  }
  const blocked = stats.blockedLegs.length > 0
    ? ` Trechos em vermelho exigem declive acima de ${SLOPE_LIMIT_DEG.car}°: o veículo para antes e a equipe segue a pé.`
    : '';
  return `Estimativa: veículo a ${fmtNumber(SPEED_KMH.car, 1)} km/h, ${STOP_MINUTES} min por parada a pé. Rota evita declives acima de ${SLOPE_LIMIT_DEG.car}° e a zona de rochas cortantes.${blocked}`;
}

function buildStats() {
  const cells = ['distância de ida', 'total com retorno', 'tempo estimado', 'subida acumulada', 'declive máximo', 'paradas científicas']
    .map((label) => ({ value: h('b', {}, '–'), label }));
  const note = h('p', { class: 'note' });
  const node = h('section', { 'aria-label': 'Resumo da rota' },
    h('div', { class: 'stats' }, cells.map((cell) => h('div', { class: 'stat' }, cell.value, h('span', {}, cell.label)))),
    note,
  );
  const render = (plan) => {
    const { stats } = plan;
    const values = [
      fmtKm(stats.outKm), fmtKm(stats.totalKm), fmtDuration(stats.hours),
      `+${Math.round(stats.gainM)} m`, `${fmtNumber(stats.maxSlopeDeg, 1)}°`, String(plan.stopCount),
    ];
    cells.forEach((cell, i) => { cell.value.textContent = values[i]; });
    note.textContent = assumptionNote(plan);
  };
  return { node, render };
}

function legRow(leg, label) {
  return h('tr', { class: leg.blocked ? 'blocked' : '' },
    h('td', {}, label, leg.blocked ? h('span', { class: 'meta' }, ' · a pé') : null),
    h('td', { class: 'n' }, fmtKm(leg.len_km)),
    h('td', { class: 'n' }, `+${Math.round(leg.gain_m)} m`),
    h('td', { class: 'n' }, `${fmtNumber(leg.max_slope, 1)}°`),
  );
}

function buildLegs() {
  const body = h('tbody');
  const node = h('section', {},
    h('h2', {}, 'Trechos'),
    h('table', { class: 'legs' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Trecho'), h('th', { class: 'n' }, 'Dist.'), h('th', { class: 'n' }, 'Subida'), h('th', { class: 'n' }, 'Decl. máx.'))),
      body,
    ),
  );
  const render = (plan) => body.replaceChildren(
    ...plan.legs.map((leg) => legRow(leg, `${shortName(leg.from)} → ${shortName(leg.to)}`)),
    legRow(plan.returnLeg, 'Retorno ao habitat'),
  );
  return { node, render };
}

const question = (label, text) => h('span', { class: 'qa' }, h('b', {}, label), text);

function stopCard(stop, handlers) {
  return h('article', { class: 'stop', dataset: { id: stop.id } },
    h('span', { class: `num${stop.id === 'H' ? ' habitat' : ''}` }, stop.id),
    h('div', { class: 'stop-body' },
      h('button', { class: 'go', type: 'button', title: 'Ver no mapa', onclick: () => handlers.onStopFocus(stop) },
        h('strong', {}, stop.name, stop.ext ? h('span', { class: 'meta' }, ' · extensão') : null)),
      h('span', { class: 'chapter' }, stop.ch),
      h('span', { class: 'meta' }, `sol ${stop.sol} · ${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)} · ${stop.el} m`),
      h('span', { class: 'txt' }, stop.sci),
      question('Pergunta', stop.q),
      question('Tarefa', stop.task),
      h('details', { class: 'why' },
        h('summary', {}, 'Por que essa parada importa'),
        question('Importância', stop.imp),
        question('O que a torna interessante', stop.int),
      ),
      stop.risk ? h('span', { class: 'risk' }, stop.risk) : null,
    ),
  );
}

function buildStops(handlers) {
  const cards = STOPS.map((stop) => ({ stop, node: stopCard(stop, handlers) }));
  const node = h('section', {}, h('h2', {}, 'Paradas'), h('div', { class: 'stops' }, cards.map((card) => card.node)));
  const render = (plan) => cards.forEach((card) => {
    const inPlan = card.stop.id === 'H' || plan.stops.some((entry) => entry.stop.id === card.stop.id);
    card.node.dataset.off = String(!inPlan);
  });
  return { node, render };
}

// Destino livre: escolhido com um clique no mapa; a rota sai na hora.
function buildDestination(handlers) {
  const optionButtons = ROUTE_OPTIONS.map((option) => ({
    id: option.id,
    node: h('button', { type: 'button', onclick: () => handlers.onRouteOptionChange(option.id) }, option.label),
  }));
  const where = h('span', { class: 'meta' });
  const card = h('div', { class: 'destination', hidden: true },
    h('strong', {}, 'Destino escolhido'),
    where,
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Critério da rota' }, optionButtons.map((button) => button.node)),
    h('span', { class: 'note' }, 'A mais segura foge mais das encostas e evita onde não há rádio direto com o habitat.'),
    h('button', { class: 'ghost', type: 'button', onclick: handlers.onClearDestination }, 'Voltar à travessia do Monte Sharp'),
  );
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const node = h('section', {},
    h('h2', {}, 'Destino livre'),
    h('p', { class: 'note' }, 'Clique em um ponto do mapa, sem arrastar, e a rota de ida e volta sai na hora, calculada sobre o relevo real.'),
    card,
    notice,
  );
  const render = (plan, state) => {
    const stop = plan.isCustom ? plan.stops[0].stop : null;
    card.hidden = !stop;
    if (stop) where.textContent = `${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)} · ${stop.el} m`;
    optionButtons.forEach((button) => button.node.setAttribute('aria-pressed', String(button.id === state.routeOption)));
    notice.hidden = !state.notice;
    notice.textContent = state.notice ?? '';
  };
  return { node, render };
}

function safetyItems(plan) {
  const { safety, mode, path } = plan;
  const { noReturn, commsGaps, commsLostM, farthest, shelter } = safety;
  const afterIt = mode === 'car'
    ? 'Se o veículo quebrar depois desse ponto, a tripulação não volta sozinha.'
    : 'Depois desse ponto, a única saída é terminar a rota.';
  const noReturnCause = noReturn?.noWalkRoute
    ? 'não há caminho a pé até o habitat dentro do limite de declive'
    : `o oxigênio não cobre mais a volta a pé (${fmtDuration(noReturn?.walkH ?? 0)} de caminhada até o habitat)`;
  const slack = safety.minMarginH === null ? '' : ` Menor folga: ${fmtDuration(safety.minMarginH)}.`;
  const walkBack = noReturn
    ? { level: 'danger', text: `A partir de ${fmtKm(noReturn.distM / 1000)} de rota, ${noReturnCause}. ${afterIt}` }
    : { level: 'ok', text: `O oxigênio cobre a volta a pé de qualquer ponto da rota, com ${ASSUMPTIONS.o2ReservePct}% de reserva.${slack}` };
  const lostShare = path.totalM > 0 ? Math.round((commsLostM / path.totalM) * 100) : 0;
  const radio = commsLostM > 0
    ? { level: lostShare > 50 ? 'danger' : 'warn', text: `${fmtKm(commsLostM / 1000)} da rota (${lostShare}%) sem linha de visada com o habitat, em ${commsGaps.length} ${commsGaps.length === 1 ? 'trecho' : 'trechos'}. Sem repetidor, não há rádio direto ali.` }
    : { level: 'ok', text: 'Toda a rota tem linha de visada com o habitat.' };
  const items = [{ label: 'Volta a pé', ...walkBack }, { label: 'Rádio', ...radio }];
  if (farthest && shelter) {
    const terrain = shelter.terrain
      ? ` Proteção de relevo a ${fmtDistance(shelter.terrain.distM)}: a encosta tapa ${Math.round(shelter.terrain.skyBlocked * 100)}% do céu (estimativa geométrica).`
      : ' Sem proteção de relevo a menos de 1,5 km.';
    items.push({
      label: 'Abrigo no ponto mais afastado',
      level: 'ok',
      text: `Habitat a ${fmtKm(shelter.habitat.distM / 1000)} em linha reta, ${fmtDuration(farthest.walkH)} a pé.${terrain}`,
    });
  }
  return items;
}

// Link para a página de origem de um fato. Só aceita endereço https.
function sourceLink(source) {
  if (!source.url.startsWith('https://')) return h('span', {}, source.label);
  return h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.label);
}

function protocolCard(protocol) {
  return h('details', { class: 'protocol' },
    h('summary', {}, protocol.title),
    h('span', { class: 'meta' }, `Gatilho: ${protocol.trigger}`),
    h('ol', {}, protocol.steps.map((step) => h('li', {}, step))),
    h('span', { class: 'meta' }, `Abrigo: ${SHELTER_KINDS[protocol.shelter]} · Passos: ${protocol.source.toLowerCase()}`),
    protocol.evidence.map((fact) => h('p', { class: 'evidence' }, `${fact.text} `, sourceLink(fact))),
  );
}

// Onde o rover tentou coletar e não conseguiu: cada item vira um destino com um clique.
function buildOpportunities(handlers) {
  const card = (entry) => {
    const position = trackPositionAtSol(entry.sol);
    return h('article', { class: 'opportunity' },
      h('strong', {}, entry.name),
      h('span', { class: 'meta' }, `sol ${entry.sol} · ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)} · ${position.elev} m`),
      h('p', { class: 'evidence' }, `${entry.what} `, sourceLink(entry.source)),
      h('button', { class: 'ghost', type: 'button', onclick: () => handlers.onPlanTo(position) }, 'Planejar ida até aqui'),
    );
  };
  return h('section', {},
    h('h2', {}, 'O que o rover não conseguiu coletar'),
    h('p', { class: 'note' }, 'Tentativas de perfuração do Curiosity que falharam nesta região. A posição é a do rover naquele sol, tirada do trajeto real. Para a equipe, são bons alvos para uma tripulação: quem está lá escolhe outra rocha, firma o bloco ou usa outra ferramenta.'),
    h('div', { class: 'stops' }, OPPORTUNITIES.map(card)),
  );
}

function buildSafety() {
  const list = h('ul', { class: 'safety-list' });
  const node = h('section', {},
    h('h2', {}, 'Segurança da saída'),
    list,
    h('p', { class: 'note' }, `Calculado sobre o relevo real. São hipóteses da equipe: consumo de oxigênio do traje, reserva de ${ASSUMPTIONS.o2ReservePct}% e antenas de ${ASSUMPTIONS.habitatMastM} m no habitat e ${ASSUMPTIONS.suitAntennaM} m no traje.`),
    h('p', { class: 'evidence' }, 'A regra da volta a pé vem das Apollo: o jipe lunar podia rodar 92 km, mas ninguém passou de 7,6 km do módulo. ', sourceLink({ label: 'NASA OCHMO-TB-023', url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-023-extraterrestrial-surface-transport-vehicles-rovers.pdf' })),
    h('h2', { style: 'margin-top:14px' }, 'O que fazer em cada cenário'),
    h('div', { class: 'protocols' }, PROTOCOLS.map(protocolCard)),
  );
  const render = (plan) => list.replaceChildren(
    ...safetyItems(plan).map((item) => h('li', { dataset: { level: item.level } }, h('b', {}, item.label), item.text)),
  );
  return { node, render };
}

// Junta os perfis dos trechos de ida em uma série (distância em km, altitude em m).
function profileSeries(legs) {
  const points = [];
  const marks = [{ id: 'H', km: 0, elev: legs[0].profile[0] }];
  let startKm = 0;
  for (const leg of legs) {
    const last = Math.max(leg.profile.length - 1, 1);
    leg.profile.forEach((elev, i) => points.push({ km: startKm + (leg.len_km * i) / last, elev }));
    startKm += leg.len_km;
    marks.push({ id: leg.to, km: startKm, elev: leg.profile[leg.profile.length - 1] });
  }
  return { points, marks, totalKm: startKm };
}

function profileChart(legs) {
  const { points, marks, totalKm } = profileSeries(legs);
  const { width, height, left, right, top, bottom, gridStepM } = PROFILE;
  const elevations = points.map((point) => point.elev);
  const minElev = Math.floor(Math.min(...elevations) / gridStepM) * gridStepM;
  const maxElev = Math.ceil(Math.max(...elevations) / gridStepM) * gridStepM;
  const toX = (km) => left + (km / totalKm) * (width - left - right);
  const toY = (elev) => top + (1 - (elev - minElev) / (maxElev - minElev)) * (height - top - bottom);
  const line = `M${points.map((point) => `${toX(point.km).toFixed(1)},${toY(point.elev).toFixed(1)}`).join('L')}`;
  const area = `${line}L${toX(totalKm)},${height - bottom}L${toX(0)},${height - bottom}Z`;

  const grid = [];
  for (let elev = minElev; elev <= maxElev; elev += gridStepM) {
    grid.push(svg('line', { x1: left, x2: width - right, y1: toY(elev), y2: toY(elev), class: 'grid' }));
    grid.push(svg('text', { x: left - 4, y: toY(elev) + 3, 'text-anchor': 'end' }, String(elev)));
  }
  const kmStep = totalKm > 6 ? 2 : 1;
  for (let km = 0; km <= totalKm; km += kmStep) {
    grid.push(svg('text', { x: toX(km), y: height - 6, 'text-anchor': 'middle' }, `${km} km`));
  }
  const dots = marks.flatMap((mark) => [
    svg('circle', { cx: toX(mark.km), cy: toY(mark.elev), r: 7, class: mark.id === 'H' ? 'mark habitat' : 'mark' }),
    svg('text', { x: toX(mark.km), y: toY(mark.elev) + 3, 'text-anchor': 'middle', class: 'mark-label' }, mark.id),
  ]);

  return svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Altitude ao longo da rota calculada' },
    ...grid,
    svg('path', { d: area, class: 'area' }),
    svg('path', { d: line, class: 'line' }),
    ...dots,
  );
}

function buildProfile() {
  const chart = h('div', { class: 'profile' });
  const node = h('section', {},
    h('h2', {}, 'Perfil de altitude da rota'),
    chart,
    h('p', { class: 'note' }, 'Altitude (m) pela distância percorrida na ida, lida do mapa de altitude real. Para comparar: o Curiosity rodou cerca de 11 km entre o habitat e o canal de enxofre.'),
  );
  // Rota sem comprimento não tem perfil para desenhar.
  const render = (plan) => chart.replaceChildren(...(plan.stats.outKm > 0 ? [profileChart(plan.legs)] : []));
  return { node, render };
}

function buildLegend() {
  const item = (className, label) => h('span', { class: 'swatch' }, h('i', { class: className }), label);
  return h('section', {},
    h('h2', {}, 'Legenda'),
    h('div', { class: 'legend' },
      item('rover', 'Trajeto do Curiosity'),
      item('route', 'Rota a pé (calculada)'),
      item('vehicle', 'Rota de veículo (calculada)'),
      item('hazard', 'Zona de risco / veículo não passa'),
    ),
    h('p', { class: 'note' }, 'As rotas são o caminho de menor custo sobre o mapa de altitude de 1 m do USGS (reamostrado para 2 m). O custo pesa declividade, rugosidade e a zona de rochas cortantes. A zona de rochas é aproximada, e blocos menores que cerca de 2 m não aparecem no mapa de altitude.'),
  );
}

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

function buildSources(realRelief) {
  const derived = realRelief ? 'Relevo, rotas, perfis e declive: ' : 'Rotas, perfis e declive: calculados sobre o ';
  const simulated = realRelief
    ? 'Simulado neste protótipo: as camadas de radiação e temperatura, a telemetria do traje e as mensagens do copiloto.'
    : 'Simulado neste protótipo: a altura do relevo entre as rotas, as camadas de radiação e temperatura, a telemetria do traje e as mensagens do copiloto.';
  return h('section', { class: 'sources' },
    h('h2', {}, 'Fontes e o que é simulado'),
    h('span', {}, 'Imagem: HiRISE colorida (MRO), mosaico da equipe MSL · NASA/JPL-Caltech/UArizona.'),
    h('span', {}, 'Trajeto e altitudes: ', link('https://mars.nasa.gov/maps/location/?mission=MSL', 'mapa oficial do Curiosity (MMGIS)'), ', sol 2300 a 4893.'),
    h('span', {}, derived, link('https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m', 'MSL Gale Merged DEM 1 m'), ' (USGS, Calef & Parker).'),
    h('span', {}, 'Unidades geológicas: ', link('https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/', "Curiosity's Proposed Path up Mount Sharp"), ' (PIA23179).'),
    h('span', { class: 'simulated' }, simulated),
  );
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   onModeChange: (mode: 'walk'|'car') => void,
 *   onExtensionChange: (include: boolean) => void,
 *   onLayerChange: (layer: string) => void,
 *   onStopFocus: (stop: object) => void,
 *   onEnterVisor: () => void,
 *   onVisorChange: (id: string) => void,
 *   onRouteOptionChange: (option: 'fast'|'safe') => void,
 *   onClearDestination: () => void,
 *   onPlanTo: (position: { lat: number, lon: number }) => void,
 * }} handlers
 * @param {{ realRelief: boolean, visors: Array<{ id: string, name: string }>, visorId: string }} options
 */
export function createTabletPanel(root, handlers, options) {
  const mode = buildModeControls(handlers);
  const destination = buildDestination(handlers);
  const safety = buildSafety();
  const layers = buildLayerControls(handlers);
  const stats = buildStats();
  const legs = buildLegs();
  const stops = buildStops(handlers);
  const profile = buildProfile();
  root.replaceChildren(
    buildHeader(handlers, options), mode.node, destination.node, layers.node, stats.node, safety.node, legs.node,
    stops.node, buildOpportunities(handlers), profile.node, buildLegend(), buildSources(options.realRelief),
  );

  function update(plan, state) {
    mode.sync(state);
    layers.sync(state);
    [stats, legs, stops, profile, safety].forEach((section) => section.render(plan));
    destination.render(plan, state);
  }

  return Object.freeze({ update });
}
