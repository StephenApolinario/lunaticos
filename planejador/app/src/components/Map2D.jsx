import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { RM, EARTH_K, fmtKm, fmtDeg } from '../lib/geo'
import { STOP, HAZARD } from '../data/stops'
import { badRuns, reachAt, fmtDur, MODE_LABEL } from '../lib/plan'
import { DATASET } from '../dataset'

const COLOR = { walk: '#16c2d5', car: '#f5c04a', hazard: '#ef4a4f', radio: '#c58cff' }
// CRS com raio de Marte: a escala do mapa mostra metros marcianos
const MarsCRS = L.extend({}, DATASET.tiles.crs === 'eq' ? L.CRS.EPSG4326 : L.CRS.EPSG3857, { R: RM * 1000 })
const icon = (cls, text, order) => L.divIcon({
  className: '',
  html: `<div class="pin ${cls}">${text}${order != null ? `<span class="ord">${order}</span>` : ''}</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
})
const deg = (r) => (r * 180) / Math.PI

/** Imagem do alcance: cores pela razão (ida + volta) / limite; fora do alcance escurece. */
function reachImage(reach, limitH) {
  const { rows, cols, rt } = reach
  const c = document.createElement('canvas'); c.width = cols; c.height = rows
  const g = c.getContext('2d'), img = g.createImageData(cols, rows), d = img.data
  // degradê verde → amarelo → laranja conforme a fração do limite, e linhas de contorno a cada hora
  const ramp = (r) => {
    const s = [[0, 60, 200, 120], [0.5, 240, 200, 60], [0.75, 240, 130, 40], [1, 230, 70, 50]]
    for (let i = 1; i < s.length; i++) if (r <= s[i][0]) {
      const a = s[i - 1], b = s[i], f = (r - a[0]) / (b[0] - a[0])
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]
    }
    return s[s.length - 1].slice(1)
  }
  for (let k = 0; k < rt.length; k++) {
    const v = rt[k], r = v / limitH, o = k * 4
    if (!(r <= 1)) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 125; continue }
    const j = k % cols, hb = Math.floor(v)
    const edge = (j + 1 < cols && Math.floor(rt[k + 1]) !== hb && rt[k + 1] <= limitH) || (k + cols < rt.length && Math.floor(rt[k + cols]) !== hb && rt[k + cols] <= limitH)
    if (edge) { d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 170; continue }
    const [cr, cg, cb] = ramp(r)
    d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 42
  }
  g.putImageData(img, 0, 0)
  return c.toDataURL()
}

export default function Map2D({ traverse, slopeBounds, showSlope, points, plan, mode, focus, meta, reach, reachWalk, limitH, onAdd, onTogglePoi, onMove, pois }) {
  const el = useRef(null)
  const map = useRef(null)
  const layers = useRef({})
  const hover = useRef(null)
  const cb = useRef({})
  cb.current = { onAdd, onTogglePoi, onMove, reachWalk, meta, limitH }

  // Mapa base (uma vez)
  useEffect(() => {
    const T = DATASET.tiles
    const m = L.map(el.current, { crs: MarsCRS, attributionControl: false, minZoom: 13, maxZoom: 19, zoomSnap: 0.5 })
    L.tileLayer(T.url, {
      minZoom: 13, maxZoom: 19, minNativeZoom: T.minNative, maxNativeZoom: T.maxNative,
      bounds: L.latLngBounds([-4.822, 137.368], [-4.718, 137.42]),
    }).addTo(m)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m)
    m.fitBounds([[-4.79, 137.375], [-4.726, 137.413]])
    L.polyline(traverse.map((p) => [p[0], p[1]]), { color: '#fff', weight: 2, opacity: 0.6, dashArray: '2 5', interactive: false }).addTo(m)
    if (DATASET.hazard) {
      L.circle([HAZARD.lat, HAZARD.lon], { radius: HAZARD.r * 1000 * EARTH_K, color: COLOR.hazard, weight: 2, fillOpacity: 0.15, dashArray: '6 4' })
        .bindTooltip(HAZARD.name).addTo(m)
    }
    const [[s, w], [n, e]] = slopeBounds
    L.rectangle([[s, w], [n, e]], { color: '#fff', weight: 1, opacity: 0.5, fill: false, dashArray: '4 6', interactive: false }).addTo(m)
    m.on('click', (ev) => {
      const { lat, lng } = ev.latlng
      if (lat > s && lat < n && lng > w && lng < e) cb.current.onAdd(lat, lng)
    })
    // leitura do alcance sob o cursor
    m.on('mousemove', (ev) => {
      const box = hover.current, c = cb.current
      if (!box) return
      const rt = reachAt(c.reachWalk, c.meta, ev.latlng.lat, ev.latlng.lng, 'rt')
      const back = reachAt(c.reachWalk, c.meta, ev.latlng.lat, ev.latlng.lng, 'toHome')
      if (rt == null) { box.hidden = true; return }
      box.hidden = false
      box.innerHTML = rt === Infinity
        ? '<b>Fora de alcance a pé</b><span>declives acima do limite no caminho</span>'
        : `Ida e volta a pé: <b class="${rt > c.limitH ? 'hi' : rt > c.limitH * 0.75 ? 'mid' : ''}">${fmtDur(rt)}</b><span>voltar daqui ao habitat: ${fmtDur(back)} · clique para adicionar</span>`
    })
    m.on('mouseout', () => { if (hover.current) hover.current.hidden = true })
    layers.current = { reach: null, slope: null, route: L.layerGroup().addTo(m), pts: L.layerGroup().addTo(m) }
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [traverse, slopeBounds])

  // Alcance
  useEffect(() => {
    const m = map.current
    if (!m) return
    layers.current.reach?.remove()
    layers.current.reach = null
    if (!reach || !meta) return
    const { R, ULX, ULY, r0, c0, step } = meta
    const f = reach.factor
    const n = deg((ULY - r0) / R), s = deg((ULY - r0 - reach.rows * f * step) / R)
    const w = deg((c0 + ULX) / R), e = deg((c0 + reach.cols * f * step + ULX) / R)
    layers.current.reach = L.imageOverlay(reachImage(reach, limitH), [[s, w], [n, e]], { interactive: false, className: 'reach-layer' }).addTo(m)
    layers.current.reach.bringToBack()
  }, [reach, limitH, meta])

  // Declividade
  useEffect(() => {
    const m = map.current
    if (!m || !slopeBounds) return
    if (!layers.current.slope) layers.current.slope = L.imageOverlay(`${DATASET.base}/slope.png`, slopeBounds, { interactive: false })
    if (showSlope) layers.current.slope.addTo(m)
    else layers.current.slope.remove()
  }, [showSlope, slopeBounds])

  // Pontos
  useEffect(() => {
    const { pts } = layers.current
    if (!pts) return
    pts.clearLayers()
    const order = Object.fromEntries(points.map((p, i) => [p.id, i]))
    for (const s of pois) {
      if (s.id in order) continue
      L.marker([s.lat, s.lon], { icon: icon('poi off', s.id), title: s.name, riseOnHover: true })
        .bindTooltip(`${s.name} · clique para adicionar à rota`, { direction: 'top', offset: [0, -14] })
        .on('click', () => cb.current.onTogglePoi(s.id))
        .addTo(pts)
    }
    points.forEach((p, i) => {
      const mk = L.marker([p.lat, p.lon], {
        draggable: p.kind !== 'poi', title: p.name, riseOnHover: true, zIndexOffset: 500,
        icon: icon(`${p.kind === 'habitat' ? 'h' : p.kind === 'custom' ? 'custom' : 'poi'}`, p.kind === 'habitat' ? 'H' : p.id, i === 0 ? null : i),
      })
        .bindTooltip(i === 0 ? `Partida · ${p.name}${p.kind !== 'poi' ? ' · arraste para mudar' : ''}` : `${i}ª parada · ${p.name}${p.kind === 'custom' ? ' · arraste para mover' : ' · clique para remover'}`, { direction: 'top', offset: [0, -14] })
        .addTo(pts)
      if (p.kind === 'poi') mk.on('click', () => cb.current.onTogglePoi(p.id))
      else mk.on('dragend', (ev) => { const ll = ev.target.getLatLng(); cb.current.onMove(p.id, ll.lat, ll.lng) })
    })
    for (const d of plan?.extra || []) {
      L.marker([d.lat, d.lon], { icon: icon('dismount', '⏚'), interactive: true, zIndexOffset: 400 })
        .bindTooltip(`${d.name}: o veículo para aqui e a equipe segue a pé`, { direction: 'top', offset: [0, -14] })
        .addTo(pts)
    }
  }, [points, pois, plan])

  // Rota calculada
  useEffect(() => {
    const { route } = layers.current
    if (!route) return
    route.clearLayers()
    if (!plan) return
    const names = Object.fromEntries([...points, ...(plan.extra || [])].map((p) => [p.id, p.short]))
    const draw = (l, ret) => {
      const col = COLOR[l.mode]
      L.polyline(l.coords, { color: col, weight: ret ? 3 : 4.5, opacity: 0.95, dashArray: ret ? '6 7' : null })
        .bindTooltip(`${MODE_LABEL[l.mode]} · ${names[l.from] ?? l.from} → ${names[l.to] ?? l.to}: ${fmtKm(l.len_km)}, ${fmtDur(l.time_h)} · declive máx. ${fmtDeg(l.max_slope)}${l.blocked ? ' · em vermelho: acima do limite' : ''}`, { sticky: true })
        .addTo(route)
      for (const r of badRuns(l, 'bad')) L.polyline(r, { color: COLOR.hazard, weight: ret ? 4 : 6, opacity: 1, interactive: false }).addTo(route)
      for (const r of badRuns(l, 'los')) L.polyline(r, { color: COLOR.radio, weight: 2, opacity: 1, dashArray: '1 6', lineCap: 'round', interactive: false, className: 'no-radio' }).addTo(route)
      if (l.unreachable) {
        const end = l.coords[l.coords.length - 1]
        L.polyline([end, l.unreachable.target], { color: '#ffffff', weight: 2, opacity: 0.9, dashArray: '3 6' })
          .bindTooltip(`Sem acesso ${l.unreachable.mode === 'car' ? 'de veículo' : 'a pé'}: faltam ${l.unreachable.gapM} m até ${names[l.to] ?? l.to}`, { sticky: true }).addTo(route)
        L.circleMarker(end, { radius: 7, color: '#ef4a4f', weight: 3, fillColor: '#0e141a', fillOpacity: 1 })
          .bindTooltip(`Ponto mais próximo alcançável de ${names[l.to] ?? l.to}`).addTo(route)
      }
    }
    plan.legs.forEach((l) => draw(l, false))
    plan.retLegs.forEach((l) => draw(l, true))
  }, [plan, points])

  // Ir até um ponto
  useEffect(() => {
    if (!focus || !map.current) return
    const p = points.find((x) => x.id === focus.id) || STOP[focus.id]
    if (p) map.current.flyTo([p.lat, p.lon], 17, { duration: 0.8 })
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={el} className="map2d" role="application" aria-label="Mapa 2D: clique para adicionar pontos à rota" />
      {points.length < 2 && (
        <div className="map-hint">{points.length === 0 ? 'Clique no mapa para marcar o ponto de partida' : 'A área colorida é até onde dá para ir e voltar a pé. Clique para adicionar uma parada'}</div>
      )}
      <div ref={hover} className="readout map-readout" hidden />
    </>
  )
}
