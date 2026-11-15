import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Panel from './components/Panel'
import Map2D from './components/Map2D'
import Scene3D from './components/Scene3D'
import { summarize, optimizeOrder } from './lib/plan'
import { useRouter } from './lib/useRouter'
import { STOP, STOPS } from './data/stops'
import { DATASET } from './dataset'

const HOME = { id: 'H', kind: 'habitat', name: 'Habitat', short: 'Habitat', lat: STOP.H.lat, lon: STOP.H.lon }
const poi = (id) => ({ id, kind: 'poi', type: 'amostra', name: STOP[id].name, short: STOP[id].short, lat: STOP[id].lat, lon: STOP[id].lon })
const EXAMPLE = [HOME, poi('1'), poi('2'), poi('3')]

// Plano salvo no endereço (#plano=...) para compartilhar com a equipe
function readHash() {
  try {
    const m = window.location.hash.match(/plano=([^&]+)/)
    if (!m) return null
    const d = JSON.parse(decodeURIComponent(m[1]))
    const points = d.p.map(([id, kind, type, lat, lon]) => (kind === 'poi' && STOP[id]
      ? { ...poi(id), type }
      : { id, kind, type, lat, lon, name: kind === 'habitat' ? 'Ponto de partida (habitat)' : `Ponto ${id.slice(1)}`, short: kind === 'habitat' ? 'Partida' : id }))
    return { points, mode: d.m, returnHome: d.r !== 0, limitH: d.l, startHour: d.s }
  } catch { return null }
}

export default function App() {
  const init = useRef(readHash()).current
  const [view, setView] = useState('2d')
  const [mode, setMode] = useState(init?.mode || 'walk')
  const [returnHome, setReturnHome] = useState(init?.returnHome ?? true)
  const [showSlope, setShowSlope] = useState(false)
  const [showReach, setShowReach] = useState(true)
  const [limitH, setLimitH] = useState(init?.limitH || 8)
  const [startHour, setStartHour] = useState(init?.startHour || 8)
  const [points, setPointsRaw] = useState(init?.points || [])
  const [focus, setFocus] = useState(null)
  const [extra, setExtra] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const history = useRef([])

  // Toda mudança nos pontos entra no histórico (para desfazer)
  const setPoints = useCallback((fn) => {
    setPointsRaw((ps) => {
      const next = typeof fn === 'function' ? fn(ps) : fn
      if (next !== ps) { history.current.push(ps); if (history.current.length > 50) history.current.shift() }
      return next
    })
  }, [])
  const undo = useCallback(() => { const prev = history.current.pop(); if (prev) setPointsRaw(prev) }, [])
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  useEffect(() => {
    Promise.all(['traverse', 'slope'].map((f) => fetch(`${DATASET.base}/data/${f}.json`).then((r) => r.json())))
      .then(([traverse, slope]) => setExtra({ traverse, slopeBounds: slope.bounds }))
      .catch((e) => setLoadError(e.message))
  }, [])

  // Mantém o plano no endereço
  useEffect(() => {
    const d = { m: mode, r: returnHome ? 1 : 0, l: limitH, s: startHour, p: points.map((p) => [p.id, p.kind, p.type || '', +p.lat.toFixed(6), +p.lon.toFixed(6)]) }
    const h = points.length ? `#plano=${encodeURIComponent(JSON.stringify(d))}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`)
  }, [points, mode, returnHome, limitH, startHour])

  const router = useRouter(points, mode, returnHome)
  const plan = useMemo(
    () => router.result && summarize({ result: router.result, mode, points, limitH, reachWalk: router.reach.walk, meta: router.meta, startHour }),
    [router.result, mode, points, limitH, router.reach.walk, router.meta, startHour],
  )

  const addPoint = useCallback((lat, lon) => {
    setPoints((ps) => {
      if (ps.length === 0) return [{ id: 'H', kind: 'habitat', name: 'Ponto de partida (habitat)', short: 'Partida', lat, lon }]
      const used = new Set(ps.filter((p) => p.kind === 'custom').map((p) => +p.id.slice(1)))
      let k = 1; while (used.has(k)) k++
      return [...ps, { id: `P${k}`, kind: 'custom', type: 'observacao', name: `Ponto ${k}`, short: `P${k}`, lat, lon }]
    })
  }, [setPoints])
  const togglePoi = useCallback((id) => {
    setPoints((ps) => (ps.some((p) => p.id === id) ? ps.filter((p) => p.id !== id) : [...ps, poi(id)]))
  }, [setPoints])
  const movePoint = useCallback((id, lat, lon) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, lat, lon } : p))), [setPoints])
  const setType = (id, type) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, type } : p)))
  const removePoint = (id) => setPoints((ps) => ps.filter((p) => p.id !== id))
  const shift = (id, d) => setPoints((ps) => {
    const i = ps.findIndex((p) => p.id === id), j = i + d
    if (i < 1 || j < 1 || j >= ps.length) return ps
    const c = [...ps]; [c[i], c[j]] = [c[j], c[i]]; return c
  })
  const onFocus = useCallback((id) => setFocus({ id, t: Date.now() }), [])
  // Move um ponto inacessível para o lugar alcançável mais próximo (vira ponto marcado, arrastável)
  const fixPoint = (id, lat, lon) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, lat, lon, kind: p.kind === 'poi' ? 'custom' : p.kind, name: p.kind === 'poi' ? `${p.short} (acesso)` : p.name } : p)))

  if (loadError) return <div className="splash">Não foi possível carregar os dados: {loadError}</div>
  if (!extra || !router.ready) return <div className="splash">Carregando relevo e grades de custo…</div>

  const reachShown = mode === 'car' ? router.reach.car : router.reach.walk
  return (
    <div className="app">
      <main className="view">
        {view === '2d' ? (
          <Map2D traverse={extra.traverse} slopeBounds={extra.slopeBounds} showSlope={showSlope}
            points={points} plan={plan} mode={mode} focus={focus} meta={router.meta}
            reach={showReach ? reachShown : null} reachWalk={router.reach.walk} limitH={limitH}
            onAdd={addPoint} onTogglePoi={togglePoi} onMove={movePoint} pois={STOPS.filter((s) => s.id !== 'H')} />
        ) : (
          <Scene3D traverse={extra.traverse} points={points} plan={plan} mode={mode} focus={focus} onAdd={addPoint}
            startHour={startHour} setStartHour={setStartHour} limitH={limitH} reachWalk={router.reach.walk} meta={router.meta} />
        )}
      </main>
      <Panel view={view} setView={setView} mode={mode} setMode={setMode} returnHome={returnHome} setReturnHome={setReturnHome}
        showSlope={showSlope} setShowSlope={setShowSlope} showReach={showReach} setShowReach={setShowReach}
        limitH={limitH} setLimitH={setLimitH} startHour={startHour} setStartHour={setStartHour}
        points={points} plan={plan} router={router} onFocus={onFocus}
        onTogglePoi={togglePoi} onRemove={removePoint} onShift={shift} onType={setType}
        onUndo={undo} canUndo={history.current.length > 0} onFix={fixPoint}
        onOptimize={() => setPoints((ps) => optimizeOrder(ps, returnHome))}
        onClear={() => setPoints([])} onExample={() => setPoints(EXAMPLE)}
        onExampleExt={() => setPoints([...EXAMPLE, poi('4'), poi('5')])} />
    </div>
  )
}
