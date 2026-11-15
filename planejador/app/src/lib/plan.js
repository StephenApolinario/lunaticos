import { DATASET } from '../dataset'

// Tipos de parada e quanto tempo cada uma leva
export const STOP_TYPES = {
  amostra: { label: 'Coleta de amostra', min: 40 },
  observacao: { label: 'Observação', min: 20 },
  foto: { label: 'Fotos / panorama', min: 10 },
  descanso: { label: 'Descanso', min: 15 },
}
export const stayH = (p) => (p.kind === 'habitat' || p.kind === 'dismount' ? 0 : (STOP_TYPES[p.type]?.min ?? 20) / 60)

const rad = (d) => (d * Math.PI) / 180
/** Índice da célula da grade (resolução total) para lat/lon. */
export function cellIJ(meta, lat, lon) {
  const { R, ULX, ULY, r0, c0, step } = meta
  return [Math.round((ULY - R * rad(lat) - r0) / step), Math.round((R * rad(lon) - ULX - c0) / step)]
}
/** Valor do campo de alcance (reduzido) num ponto. */
export function reachAt(reach, meta, lat, lon, field = 'rt') {
  if (!reach || !meta) return null
  const [i, j] = cellIJ(meta, lat, lon)
  const a = Math.floor(i / reach.factor), b = Math.floor(j / reach.factor)
  if (a < 0 || b < 0 || a >= reach.rows || b >= reach.cols) return null
  const v = reach[field][a * reach.cols + b]
  return Number.isFinite(v) ? v : Infinity
}

export const fmtDur = (h) => {
  if (!Number.isFinite(h)) return '—'
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
export const fmtClock = (h) => {
  const m = Math.round(((h % 24) + 24) % 24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Plano completo da saída: totais, cronograma, alertas e linha do tempo para a simulação. */
export function summarize({ result, mode, points, limitH, reachWalk, meta, startHour }) {
  const all = result.legs
  const legs = all.filter((l) => !l.isReturn)
  const retLegs = all.filter((l) => l.isReturn)
  const byId = Object.fromEntries([...points, ...(result.extra || [])].map((p) => [p.id, p]))
  const stops = new Set(points.slice(1).map((p) => p.id))

  // Cronograma e linha do tempo
  const timeline = [] // { t, lat, lon, leg, mode, los }
  const schedule = []
  let t = 0
  all.forEach((l, li) => {
    l.coords.forEach((c, k) => timeline.push({ t: t + l.tcum[k], lat: c[0], lon: c[1], leg: li, mode: l.mode, los: l.los[k] }))
    t += l.time_h
    const p = byId[l.to]
    if (stops.has(l.to) && !schedule.some((s) => s.id === l.to)) {
      const stay = stayH(p)
      const [elat, elon] = l.coords[l.coords.length - 1] // onde a equipe de fato para (pode ser antes, se inacessível)
      const back = reachAt(reachWalk, meta, elat, elon, 'toHome')
      schedule.push({ id: p.id, name: p.name, short: p.short, arrive: t, leave: t + stay, stay, back, unreachable: l.unreachable })
      if (stay > 0) timeline.push({ t: t + stay, lat: elat, lon: elon, leg: li, mode: l.mode, los: l.los[l.los.length - 1], stop: p.id })
      t += stay
    }
  })
  const totalH = t

  const sum = (arr, f) => arr.reduce((a, l) => a + f(l), 0)
  const out = sum(legs, (l) => l.len_km)
  const total = sum(all, (l) => l.len_km)
  const up = sum(legs, (l) => l.gain_m)
  const maxSlope = all.length ? Math.max(...all.map((l) => l.max_slope)) : null
  const noRadioKm = sum(all, (l) => l.noRadio * l.len_km)
  const walkKm = sum(all.filter((l) => l.mode === 'walk'), (l) => l.len_km)

  // Alertas
  const alerts = []
  const lim = (m) => meta?.limits?.[m] ?? 15
  for (const l of all) {
    if (!l.unreachable) continue
    const u = l.unreachable, p = byId[l.to], [la, lo] = l.coords[l.coords.length - 1]
    const how = u.mode === 'car' ? 'de veículo' : 'a pé'
    if (l.isReturn && l.to === points[0].id) {
      alerts.push({ level: 'danger', text: `Não há caminho de volta ao habitat ${how} com declive até ${lim(u.mode)}°: a rota para a ${u.gapM} m dele.` })
      continue
    }
    alerts.push({
      level: 'danger',
      text: `${p?.short ?? l.to} é inacessível ${how} com declive até ${lim(u.mode)}°. A rota vai até o ponto alcançável mais próximo, a ${u.gapM} m${u.dz > 5 ? ` (o alvo fica ${u.dz} m acima)` : u.dz < -5 ? ` (o alvo fica ${-u.dz} m abaixo)` : ''}. Dá para observar de lá, mover o ponto ou escolher outro alvo.`,
      action: p && p.kind !== 'habitat' ? { label: `Mover ${p.short} para o ponto acessível`, id: p.id, lat: la, lon: lo } : null,
    })
  }
  for (const [id, s] of Object.entries(result.snapped || {})) {
    const p = byId[id]
    if (!p || s.distM < 4 || all.some((l) => l.unreachable && l.to === id)) continue
    alerts.push({ level: 'info', text: `${p.short} está numa encosta de ${s.slope}°. A rota usa o lugar transitável mais próximo, a ${s.distM} m.` })
  }
  if (totalH > limitH) alerts.push({ level: 'danger', text: `A saída leva ${fmtDur(totalH)}, acima do limite de ${fmtDur(limitH)}. Corte paradas ou divida em duas saídas.` })
  const pnr = schedule.find((s) => s.leave + (s.back ?? 0) > limitH)
  if (pnr) {
    alerts.push({
      level: mode === 'walk' ? 'danger' : 'warn',
      text: mode === 'walk'
        ? `Ponto de não retorno em ${pnr.short}: saindo de lá às ${fmtDur(pnr.leave)} de EVA, voltar a pé leva ${fmtDur(pnr.back)} e passa do limite.`
        : `Se o veículo falhar em ${pnr.short}, voltar a pé leva ${fmtDur(pnr.back)} e passa do limite da saída (regra de retorno a pé).`,
    })
  }
  const unreachable = schedule.filter((s) => s.back === Infinity)
  if (unreachable.length) alerts.push({ level: 'warn', text: `Sem retorno a pé seguro a partir de ${unreachable.map((s) => s.short).join(', ')} (declives acima do limite).` })
  if (total > 0 && noRadioKm / total > 0.02) alerts.push({ level: 'warn', text: `${Math.round((noRadioKm / total) * 100)}% da rota fica sem linha de visada de rádio com o habitat (atrás do relevo). Planeje um relé ou contato pelo veículo.` })
  if (result.outside?.length) alerts.push({ level: 'warn', text: 'Há pontos fora da área com relevo; eles foram levados para a borda mais próxima.' })
  if (!alerts.some((a) => a.level !== 'info') && all.length) alerts.push({ level: 'ok', text: 'Dentro do limite da saída, com retorno a pé possível de todas as paradas.' })

  const notes = [
    mode === 'walk' ? 'Velocidade a pé varia com o declive (até 3,6 km/h no plano, com traje e carga).'
      : mode === 'car' ? 'Veículo a até 6 km/h no plano, mais lento em declives.'
        : 'Híbrido: veículo até onde o declive permite, depois a pé até a parada e de volta ao veículo.',
    `Tempo de parada por tipo; início às ${fmtClock(startHour)} (hora solar local).`,
  ]

  return {
    legs, retLegs, all, n: points.length - 1, out, total, up, maxSlope, totalH, schedule, alerts, notes, timeline,
    walkKm, noRadio: total ? noRadioKm / total : 0, extra: result.extra || [], limitH,
    isOver: totalH > limitH,
  }
}

/** Pedaços contíguos do trecho que passam do limite de declive. */
export function badRuns(leg, flag = 'bad') {
  const runs = []
  let cur = null
  const on = (i) => (flag === 'bad' ? leg.bad?.[i] : leg.los && !leg.los[i])
  leg.coords.forEach((c, i) => {
    if (on(i)) { if (!cur) { cur = i > 0 ? [leg.coords[i - 1]] : []; runs.push(cur) } cur.push(c) }
    else if (cur) { cur.push(c); cur = null }
  })
  return runs.filter((r) => r.length > 1)
}

/** Posição na linha do tempo (interpolada). */
export function sampleTimeline(tl, t) {
  if (!tl.length) return null
  if (t <= tl[0].t) return { ...tl[0], idx: 0 }
  for (let k = 1; k < tl.length; k++) {
    if (tl[k].t >= t) {
      const a = tl[k - 1], b = tl[k], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
      return { ...b, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, idx: k, f, prev: a }
    }
  }
  return { ...tl[tl.length - 1], idx: tl.length - 1 }
}

/** Reordena as paradas pelo menor caminho (vizinho mais próximo + 2-opt sobre a distância em linha reta). */
export function optimizeOrder(points, returnHome) {
  if (points.length < 4) return points
  const d = (a, b) => Math.hypot((a.lat - b.lat), (a.lon - b.lon) * Math.cos(rad(a.lat)))
  const [home, ...rest] = points
  const route = []
  let cur = home
  const left = [...rest]
  while (left.length) {
    let bi = 0
    left.forEach((p, i) => { if (d(cur, p) < d(cur, left[bi])) bi = i })
    cur = left.splice(bi, 1)[0]
    route.push(cur)
  }
  const len = (r) => { let s = d(home, r[0]); for (let i = 1; i < r.length; i++) s += d(r[i - 1], r[i]); return s + (returnHome ? d(r[r.length - 1], home) : 0) }
  let best = len(route), improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < route.length - 1; i++) for (let k = i + 1; k < route.length; k++) {
      const c = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)]
      const L = len(c)
      if (L < best - 1e-12) { route.splice(0, route.length, ...c); best = L; improved = true }
    }
  }
  return [home, ...route]
}

export const MODE_LABEL = { walk: 'a pé', car: 'veículo', hybrid: 'híbrido' }
export const datasetHazard = () => DATASET.hazard
