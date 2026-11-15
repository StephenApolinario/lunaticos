import { useEffect, useRef, useState } from 'react'
import { DATASET } from '../dataset'

/**
 * Liga o Web Worker do roteador ao React.
 * - rota: recalcula quando pontos ou modo mudam
 * - alcance: tempo de ida e volta (a pé, e de veículo quando preciso) a partir da partida
 */
export function useRouter(points, mode, returnHome) {
  const worker = useRef(null)
  const ids = useRef({ route: 0, reach: {} })
  const [ready, setReady] = useState(false)
  const [meta, setMeta] = useState(null)
  const [state, setState] = useState({ status: 'loading', result: null, error: null })
  const [reach, setReach] = useState({}) // { walk: {...}, car: {...} }
  const [reachBusy, setReachBusy] = useState(false)

  useEffect(() => {
    const w = new Worker(new URL('./router.worker.js', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'ready') { setMeta(m.meta); setReady(true) }
      else if (m.type === 'route' && m.id === ids.current.route) setState({ status: 'ok', result: m, error: null })
      else if (m.type === 'reach' && m.id === ids.current.reach[m.mode]) { setReach((r) => ({ ...r, [m.mode]: m })); setReachBusy(false) }
      else if (m.type === 'error') setState((s) => ({ status: 'error', result: s.result, error: m.message }))
    }
    w.postMessage({ type: 'init', base: new URL(DATASET.base || '/', window.location.origin).href.replace(/\/$/, '') })
    return () => w.terminate()
  }, [])

  // Rota (com pequena espera para não recalcular a cada movimento)
  const key = JSON.stringify([points.map((p) => [p.id, p.lat.toFixed(6), p.lon.toFixed(6)]), mode, returnHome])
  useEffect(() => {
    if (!ready) return
    if (points.length < 2) { setState({ status: 'ok', result: { legs: [], extra: [], elev: {}, outside: [] }, error: null }); return }
    const t = setTimeout(() => {
      const id = ++ids.current.route
      setState((s) => ({ ...s, status: 'routing' }))
      worker.current.postMessage({ type: 'route', id, mode, returnHome, points: points.map(({ id, lat, lon }) => ({ id, lat, lon })) })
    }, 150)
    return () => clearTimeout(t)
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alcance a partir da partida
  const home = points[0]
  const homeKey = home ? `${home.lat.toFixed(6)},${home.lon.toFixed(6)}` : ''
  const needCar = mode !== 'walk'
  useEffect(() => {
    if (!ready || !home) { setReach({}); return }
    const t = setTimeout(() => {
      setReachBusy(true)
      for (const m of needCar ? ['walk', 'car'] : ['walk']) {
        const id = (ids.current.reach[m] || 0) + 1
        ids.current.reach[m] = id
        worker.current.postMessage({ type: 'reach', id, mode: m, home: { lat: home.lat, lon: home.lon }, capH: 12 })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [ready, homeKey, needCar]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, meta, ready, reach, reachBusy }
}
