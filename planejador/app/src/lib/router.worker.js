/* Roteador no navegador (Web Worker), sobre as grades exportadas por pipeline/export_grids.py.
   - Rotas: A* de menor custo (declividade, rugosidade, riscos)
   - Tempo: velocidade em função do declive (função de Tobler adaptada ao traje; veículo cai com o declive)
   - Modo híbrido: veículo até onde passa, desembarque, trecho final a pé
   - Rádio: linha de visada entre a antena do habitat e o astronauta, sobre o relevo
   - Alcance: tempo de ida e de volta a pé/de veículo para toda a área (Dijkstra) */

let G = null
const BIG = 1000
const SQRT2 = Math.SQRT2
const R_MARS = 3389500
export const ANTENNA_M = 10 // mastro do habitat
const EYE_M = 2 // antena do traje

async function load(base) {
  const get = (f) => fetch(`${base}/grid/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.arrayBuffer() })
  const [meta, walk, car, slope, height] = await Promise.all([
    fetch(`${base}/grid/meta.json`).then((r) => r.json()),
    get('cost_walk.bin'), get('cost_car.bin'), get('slope.bin'), get('height.bin'),
  ])
  const N = meta.rows * meta.cols
  G = {
    meta, N,
    cost: { walk: new Uint8Array(walk), car: new Uint8Array(car) },
    slope: new Uint8Array(slope), height: new Uint16Array(height),
    g: new Float32Array(N), from: new Int32Array(N), stamp: new Uint32Array(N), closed: new Uint32Array(N), gen: 0,
  }
}

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI
function toCell(lat, lon) {
  const { R, ULX, ULY, r0, c0, step, rows, cols } = G.meta
  const i = Math.round((ULY - R * rad(lat) - r0) / step), j = Math.round((R * rad(lon) - ULX - c0) / step)
  return [Math.min(rows - 1, Math.max(0, i)), Math.min(cols - 1, Math.max(0, j))]
}
function toLatLon(i, j) {
  const { R, ULX, ULY, r0, c0, step } = G.meta
  return [deg((ULY - (r0 + i * step + step / 2)) / R), deg((c0 + j * step + step / 2 + ULX) / R)]
}
const inside = (lat, lon) => {
  const { R, ULX, ULY, r0, c0, step, rows, cols } = G.meta
  const i = (ULY - R * rad(lat) - r0) / step, j = (R * rad(lon) - ULX - c0) / step
  return i >= 0 && j >= 0 && i < rows && j < cols
}
const Z = (u) => G.height[u] / 10 + G.meta.hmin

function snap(cost, i, j) {
  const { rows, cols } = G.meta
  if (cost[i * cols + j] !== 255) return [i, j]
  for (let r = 1; r < 50; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
      const a = i + di, b = j + dj
      if (a >= 0 && b >= 0 && a < rows && b < cols && cost[a * cols + b] !== 255) return [a, b]
    }
  }
  return [i, j]
}

// ---------- velocidade ----------
/** km/h em função da inclinação S = dz/dx (positiva subindo). */
function speed(mode, S) {
  if (mode === 'walk') return Math.max(0.3, 3.6 * Math.exp(-3.5 * Math.abs(S + 0.05))) // Tobler com teto de 3,6 km/h (traje + carga)
  const sl = (Math.atan(Math.abs(S)) * 180) / Math.PI
  return Math.max(1.0, 6 * (1 - sl / 25)) // veículo: 6 km/h no plano, cai com o declive
}

// ---------- fila de prioridade ----------
let hk = new Float64Array(1 << 20), hv = new Int32Array(1 << 20), hn = 0
function push(k, v) {
  if (hn === hk.length) { const k2 = new Float64Array(hn * 2); k2.set(hk); hk = k2; const v2 = new Int32Array(hn * 2); v2.set(hv); hv = v2 }
  let i = hn++
  while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p }
  hk[i] = k; hv[i] = v
}
function popKey() { return hk[0] }
function pop() {
  const top = hv[0], k = hk[--hn], v = hv[hn]
  let i = 0
  for (;;) {
    let c = 2 * i + 1
    if (c >= hn) break
    if (c + 1 < hn && hk[c + 1] < hk[c]) c++
    if (hk[c] >= k) break
    hk[i] = hk[c]; hv[i] = hv[c]; i = c
  }
  hk[i] = k; hv[i] = v
  return top
}
const DI = [-1, -1, -1, 0, 0, 1, 1, 1], DJ = [-1, 0, 1, -1, 1, -1, 0, 1]
const DD = [SQRT2, 1, SQRT2, 1, 1, SQRT2, 1, SQRT2]

// ---------- A* ----------
/** Caminho de menor custo só por terreno transitável. Se o destino for inalcançável,
 *  devolve o caminho até a célula alcançável mais próxima dele (approach). */
function astar(mode, s, e) {
  const r = astarRaw(mode, s, e)
  if (r) return { path: r, reached: true }
  const { cols, N } = { cols: G.meta.cols, N: G.N }
  const gen = G.gen, [ei, ej] = e
  let best = -1, bd = Infinity
  for (let u = 0; u < N; u++) {
    if (G.closed[u] !== gen) continue
    const i = (u / cols) | 0, j = u - i * cols, d = (i - ei) ** 2 + (j - ej) ** 2
    if (d < bd) { bd = d; best = u }
  }
  const path = []
  for (let u = best; u !== -1; u = G.from[u]) path.push(u)
  return { path: path.reverse(), reached: false }
}
function astarRaw(mode, s, e) {
  const { cols, rows, step, costScale } = G.meta
  const cost = G.cost[mode], { g, from, stamp, closed } = G
  const gen = ++G.gen
  const cc = (k) => cost[k] / costScale
  const [ei, ej] = e
  const h = (i, j) => { const a = Math.abs(i - ei), b = Math.abs(j - ej); return step * (Math.max(a, b) + (SQRT2 - 1) * Math.min(a, b)) }
  const start = s[0] * cols + s[1], goal = ei * cols + ej
  hn = 0
  g[start] = 0; stamp[start] = gen; from[start] = -1
  push(h(s[0], s[1]), start)
  while (hn > 0) {
    const u = pop()
    if (closed[u] === gen) continue
    closed[u] = gen
    if (u === goal) break
    const ui = (u / cols) | 0, uj = u - ui * cols, gu = g[u], cu = cc(u)
    for (let n = 0; n < 8; n++) {
      const vi = ui + DI[n], vj = uj + DJ[n]
      if (vi < 0 || vj < 0 || vi >= rows || vj >= cols) continue
      const v = vi * cols + vj
      if (closed[v] === gen || cost[v] === 255) continue // declive acima do limite: intransitável
      const nv = gu + step * DD[n] * (cu + cc(v)) * 0.5
      if (stamp[v] !== gen || nv < g[v]) { g[v] = nv; stamp[v] = gen; from[v] = u; push(nv + h(vi, vj), v) }
    }
  }
  if (closed[goal] !== gen) return null
  const path = []
  for (let u = goal; u !== -1; u = from[u]) path.push(u)
  return path.reverse()
}

// ---------- linha de visada (rádio) ----------
function hasLOS(a, ah, b, bh) {
  const { cols, step } = G.meta
  const ai = (a / cols) | 0, aj = a - ai * cols, bi = (b / cols) | 0, bj = b - bi * cols
  const n = Math.max(Math.abs(bi - ai), Math.abs(bj - aj))
  if (n < 2) return true
  const za = Z(a) + ah, zb = Z(b) + bh, D = n * step
  for (let k = 1; k < n; k++) {
    const t = k / n
    const i = Math.round(ai + (bi - ai) * t), j = Math.round(aj + (bj - aj) * t)
    const x = t * D
    const line = za + (zb - za) * t - (x * (D - x)) / (2 * R_MARS) // curvatura de Marte
    if (Z(i * cols + j) > line) return false
  }
  return true
}

// ---------- estatísticas de um trecho ----------
function legStats(mode, path, fromId, toId, home) {
  const { cols, step, slopeScale } = G.meta
  const cost = G.cost[mode]
  let len = 0, gain = 0, loss = 0, maxS = 0, blocked = false, t = 0
  const slopes = [], coords = [], profile = [], bad = [], tcum = [], los = []
  let winBad = false, pi = -1, pj = -1, pz = 0
  for (let k = 0; k < path.length; k++) {
    const u = path[k], i = (u / cols) | 0, j = u - i * cols
    const z = Z(u), s = G.slope[u] / slopeScale
    slopes.push(s); if (s > maxS) maxS = s
    if (cost[u] === 255) { blocked = true; winBad = true }
    if (k > 0) {
      const d = step * Math.hypot(i - pi, j - pj), dz = z - pz
      len += Math.hypot(d, dz)
      if (dz > 0) gain += dz; else loss -= dz
      t += d / 1000 / speed(mode, dz / d)
    }
    if (k % 5 === 0 || k === path.length - 1) {
      coords.push(toLatLon(i, j)); profile.push(Math.round(z)); bad.push(winBad); winBad = false
      tcum.push(t)
      los.push(home == null ? true : hasLOS(home, ANTENNA_M, u, EYE_M))
    }
    pi = i; pj = j; pz = z
  }
  slopes.sort((a, b) => a - b)
  const noRadio = los.filter((v) => !v).length / Math.max(1, los.length)
  return {
    mode, from: fromId, to: toId, coords, profile, bad, tcum, los,
    len_km: len / 1000, gain_m: gain, loss_m: loss, time_h: t,
    max_slope: Math.round(maxS * 10) / 10,
    p95_slope: Math.round(slopes[Math.floor(slopes.length * 0.95)] * 10) / 10,
    blocked, noRadio,
  }
}

const cellOf = (p, mode) => { const c = snap(G.cost[mode], ...toCell(p.lat, p.lon)); return c[0] * G.meta.cols + c[1] }
const ij = (u) => { const i = (u / G.meta.cols) | 0; return [i, u - i * G.meta.cols] }
const distM = (u, v) => { const [a, b] = ij(u), [c, d] = ij(v); return G.meta.step * Math.hypot(a - c, b - d) }

/** Marca o trecho que não chegou ao destino: onde parou e quanto faltou. */
function markUnreachable(leg, path, target, mode) {
  const end = path[path.length - 1], tcell = cellOf(target, mode)
  const raw = toCell(target.lat, target.lon), rawCell = raw[0] * G.meta.cols + raw[1]
  leg.unreachable = { gapM: Math.round(distM(end, rawCell)), dz: Math.round(Z(tcell) - Z(end)), target: [target.lat, target.lon], mode }
  return leg
}

function route(mode, seq, home) {
  const legs = []
  let cur = cellOf(seq[0], mode), curId = seq[0].id
  for (let k = 1; k < seq.length; k++) {
    const b = seq[k], t = cellOf(b, mode)
    const r = astar(mode, ij(cur), ij(t))
    const leg = legStats(mode, r.path, curId, b.id, home)
    if (!r.reached) markUnreachable(leg, r.path, b, mode)
    legs.push(leg)
    cur = r.path[r.path.length - 1]; curId = b.id
  }
  return { legs, extra: [] }
}

/** Veículo até onde o terreno permite; se não alcançar, desembarca no ponto mais próximo e segue a pé. */
function routeHybrid(seq, home) {
  const legs = [], extra = []
  let vehicle = cellOf(seq[0], 'car'), vehicleId = seq[0].id, crew = vehicle, crewId = seq[0].id
  for (let k = 1; k < seq.length; k++) {
    const target = seq[k]
    if (crew !== vehicle) { // tripulação volta a pé até o veículo
      const back = astar('walk', ij(crew), ij(vehicle))
      legs.push(legStats('walk', back.path, crewId, vehicleId, home))
      crew = vehicle; crewId = vehicleId
    }
    const car = astar('car', ij(vehicle), ij(cellOf(target, 'car')))
    if (car.reached) {
      legs.push(legStats('car', car.path, vehicleId, target.id, home))
      vehicle = crew = car.path[car.path.length - 1]; vehicleId = crewId = target.id
      continue
    }
    const dismount = car.path[car.path.length - 1]
    if (dismount !== vehicle) {
      const id = `D${extra.length + 1}`
      const [la, lo] = toLatLon(...ij(dismount))
      extra.push({ id, lat: la, lon: lo, kind: 'dismount', name: `Desembarque ${extra.length + 1}`, short: `D${extra.length + 1}` })
      legs.push(legStats('car', car.path, vehicleId, id, home))
      vehicle = crew = dismount; vehicleId = crewId = id
    }
    const walk = astar('walk', ij(vehicle), ij(cellOf(target, 'walk')))
    const leg = legStats('walk', walk.path, vehicleId, target.id, home)
    if (!walk.reached) markUnreachable(leg, walk.path, target, 'walk')
    legs.push(leg)
    crew = walk.path[walk.path.length - 1]; crewId = target.id
    if (target.id === seq[0].id && walk.reached) { vehicle = crew; vehicleId = crewId } // chegou a pé ao habitat
  }
  return { legs, extra }
}

/** Pontos que caíram em encosta acima do limite e foram levados ao lugar transitável mais próximo. */
function snapped(points, mode) {
  const out = {}
  const m = mode === 'car' ? 'car' : 'walk'
  for (const p of points) {
    const [i, j] = toCell(p.lat, p.lon), raw = i * G.meta.cols + j
    if (G.cost[m][raw] !== 255) continue
    const c = cellOf(p, m), [a, b] = ij(c), [la, lo] = toLatLon(a, b)
    out[p.id] = { lat: la, lon: lo, distM: Math.round(distM(raw, c)), slope: Math.round(G.slope[raw] / G.meta.slopeScale) }
  }
  return out
}

// ---------- alcance: tempo de ida e de volta para toda a área ----------
function timeField(mode, src, reverse, capH) {
  const { cols, rows, step } = G.meta
  const cost = G.cost[mode], N = G.N
  const t = new Float32Array(N).fill(Infinity)
  const done = new Uint8Array(N)
  hn = 0; t[src] = 0; push(0, src)
  while (hn > 0) {
    if (popKey() > capH) break
    const u = pop()
    if (done[u]) continue
    done[u] = 1
    const ui = (u / cols) | 0, uj = u - ui * cols, zu = Z(u), tu = t[u]
    for (let n = 0; n < 8; n++) {
      const vi = ui + DI[n], vj = uj + DJ[n]
      if (vi < 0 || vj < 0 || vi >= rows || vj >= cols) continue
      const v = vi * cols + vj
      if (done[v] || cost[v] === 255) continue
      const d = step * DD[n], dz = Z(v) - zu
      const S = reverse ? -dz / d : dz / d // volta: o movimento é de v para u
      const nt = tu + d / 1000 / speed(mode, S)
      if (nt < t[v]) { t[v] = nt; push(nt, v) }
    }
  }
  return t
}

function reach(mode, home, capH) {
  const { rows, cols } = G.meta
  const src = cellOf(home, mode)
  const out = timeField(mode, src, false, capH)
  const back = timeField(mode, src, true, capH)
  // reduz para ~4 m para enviar à interface
  const f = G.meta.step < 3 ? 2 : 1
  const R2 = Math.floor(rows / f), C2 = Math.floor(cols / f)
  const rt = new Float32Array(R2 * C2), toHome = new Float32Array(R2 * C2)
  for (let i = 0; i < R2; i++) for (let j = 0; j < C2; j++) {
    const u = i * f * cols + j * f
    rt[i * C2 + j] = out[u] + back[u]
    toHome[i * C2 + j] = back[u]
  }
  return { rows: R2, cols: C2, factor: f, rt, toHome }
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      await load(msg.base)
      self.postMessage({ type: 'ready', meta: G.meta })
    } else if (msg.type === 'route') {
      const t0 = performance.now()
      const { mode, points, returnHome } = msg
      const outside = points.filter((p) => !inside(p.lat, p.lon)).map((p) => p.id)
      const seq = returnHome && points.length > 1 ? [...points, points[0]] : points
      const home = cellOf(points[0], 'walk')
      const r = mode === 'hybrid' ? routeHybrid(seq, home) : route(mode, seq, home)
      // trechos depois da última parada são o retorno
      if (returnHome && points.length > 1) {
        const lastStop = points[points.length - 1].id
        let k = r.legs.length - 1
        while (k >= 0 && r.legs[k].from !== lastStop) k--
        for (let i = Math.max(0, k); i < r.legs.length; i++) r.legs[i].isReturn = true
      }
      const elev = Object.fromEntries(points.map((p) => { const [i, j] = toCell(p.lat, p.lon); return [p.id, Math.round(Z(i * G.meta.cols + j))] }))
      self.postMessage({ type: 'route', id: msg.id, legs: r.legs, extra: r.extra, elev, outside, snapped: snapped(points, mode), ms: Math.round(performance.now() - t0) })
    } else if (msg.type === 'reach') {
      const t0 = performance.now()
      const res = reach(msg.mode, msg.home, msg.capH)
      self.postMessage({ type: 'reach', id: msg.id, mode: msg.mode, ...res, ms: Math.round(performance.now() - t0) }, [res.rt.buffer, res.toHome.buffer])
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err.message })
  }
}
