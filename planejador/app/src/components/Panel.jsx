import { useState } from 'react'
import { STOPS } from '../data/stops'
import { fmtKm, fmtDeg, fmtNum } from '../lib/geo'
import { STOP_TYPES, fmtDur, fmtClock, MODE_LABEL } from '../lib/plan'
import Profile from './Profile'
import { DATASET } from '../dataset'

const MODE_ICON = { walk: '🚶', car: '🚙' }

export default function Panel({
  view, setView, mode, setMode, returnHome, setReturnHome, showSlope, setShowSlope, showReach, setShowReach,
  limitH, setLimitH, startHour, setStartHour, points, plan, router, onFocus, onTogglePoi, onRemove, onShift, onType,
  onUndo, canUndo, onOptimize, onClear, onExample, onExampleExt, onFix,
}) {
  const [copied, setCopied] = useState(false)
  const inRoute = new Set(points.map((p) => p.id))
  const unreach = new Set((plan?.all || []).filter((l) => l.unreachable && !l.isReturn).map((l) => l.to))
  const names = Object.fromEntries([...points, ...(plan?.extra || [])].map((p) => [p.id, p.short]))
  const short = (id) => names[id] ?? id
  const order = (id) => points.findIndex((p) => p.id === id)
  const elev = router.result?.elev || {}
  const hasRoute = plan && plan.all.length > 0
  const status = router.status === 'routing' ? 'Calculando a melhor rota…'
    : router.status === 'error' ? `Não foi possível calcular: ${router.error}`
      : router.result?.ms != null && hasRoute ? `Rota calculada em ${(router.result.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s sobre o relevo` : ''
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* sem permissão */ }
  }
  const row = (l, label) => (
    <tr key={label} className={l.blocked ? 'blk' : ''}>
      <td><span className="mi" title={MODE_LABEL[l.mode]}>{MODE_ICON[l.mode]}</span>{label}{l.blocked && <span className="meta"> · acima do limite</span>}</td>
      <td className="n">{fmtKm(l.len_km)}</td>
      <td className="n">{fmtDur(l.time_h)}</td>
      <td className="n">+{Math.round(l.gain_m)} m</td>
      <td className="n">{fmtDeg(l.max_slope)}</td>
    </tr>
  )
  const usedPct = plan ? Math.min(1.15, plan.totalH / limitH) : 0

  return (
    <aside className="panel">
      <header>
        {DATASET.badge && <div className="badge">{DATASET.badge}</div>}
        <div className="eyebrow">Cratera Gale · Monte Sharp · Marte</div>
        <h1>Planejador de travessia</h1>
        <p className="lede">Marque os pontos no mapa ou no terreno 3D, escolha como ir e o app calcula a melhor rota, o tempo e os riscos sobre o relevo real.</p>
      </header>

      <section className="controls" aria-label="Controles">
        <div className="seg" role="group" aria-label="Visão">
          <button aria-pressed={view === '2d'} onClick={() => setView('2d')}>Mapa 2D</button>
          <button aria-pressed={view === '3d'} onClick={() => setView('3d')}>Terreno 3D</button>
        </div>
        <div className="seg three" role="group" aria-label="Modo de deslocamento">
          <button aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>🚶 A pé</button>
          <button aria-pressed={mode === 'car'} onClick={() => setMode('car')}>🚙 Veículo</button>
          <button aria-pressed={mode === 'hybrid'} onClick={() => setMode('hybrid')} title="Veículo até onde o declive permite, depois a pé">🚙+🚶 Híbrido</button>
        </div>
        <label className="opt">Duração máxima da saída
          <input type="range" min="3" max="10" step="0.5" value={limitH} onChange={(e) => setLimitH(+e.target.value)} />
          <output>{fmtNum(limitH)} h</output>
        </label>
        <label className="opt">Início da saída
          <input type="range" min="6" max="14" step="0.25" value={startHour} onChange={(e) => setStartHour(+e.target.value)} />
          <output>{fmtClock(startHour)}</output>
        </label>
        <label className="opt"><input type="checkbox" checked={returnHome} onChange={(e) => setReturnHome(e.target.checked)} /> Voltar ao habitat no fim</label>
        {view === '2d' && (
          <>
            <label className="opt"><input type="checkbox" checked={showReach} onChange={(e) => setShowReach(e.target.checked)} /> Mostrar alcance (ida e volta {mode === 'car' ? 'de veículo' : 'a pé'}){router.reachBusy && <span className="meta"> · calculando…</span>}</label>
            <label className="opt"><input type="checkbox" checked={showSlope} onChange={(e) => setShowSlope(e.target.checked)} /> Mostrar declividade do terreno</label>
          </>
        )}
      </section>

      <section aria-label="Pontos da rota">
        <h2>Sua rota</h2>
        <ol className="wps">
          {points.map((p, i) => (
            <li key={p.id} className="wp">
              <span className={`num ${p.kind === 'habitat' ? 'h' : p.kind === 'custom' ? 'c' : ''}`}>{i === 0 ? 'H' : i}</span>
              <div className="wp-body">
                <button className="go" onClick={() => onFocus(p.id)} title="Ver no mapa">
                  <strong>{p.name}{unreach.has(p.id) && <span className="warn-badge" title="Inacessível: a rota para antes"> ⚠ sem acesso</span>}</strong>
                  <span className="meta">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}{elev[p.id] != null && ` · ${elev[p.id]} m`}</span>
                </button>
                {i > 0 && (
                  <select className="type" value={p.type || 'observacao'} onChange={(e) => onType(p.id, e.target.value)} aria-label={`Tipo de parada em ${p.name}`}>
                    {Object.entries(STOP_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label} · {t.min} min</option>)}
                  </select>
                )}
              </div>
              <span className="wp-act">
                {i > 0 && <button onClick={() => onShift(p.id, -1)} disabled={i === 1} aria-label={`Subir ${p.name}`}>↑</button>}
                {i > 0 && <button onClick={() => onShift(p.id, 1)} disabled={i === points.length - 1} aria-label={`Descer ${p.name}`}>↓</button>}
                <button onClick={() => onRemove(p.id)} aria-label={`Remover ${p.name}`}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        {points.length === 0 && <p className="note empty">Nenhum ponto ainda. Clique no mapa 2D ou no terreno 3D para marcar o <strong>ponto de partida</strong> (habitat). A área colorida mostra até onde dá para ir e voltar.</p>}
        {points.length === 1 && <p className="note">Partida marcada. Agora clique no mapa ou em um ponto de interesse para adicionar paradas. A área colorida mostra o alcance a partir daqui.</p>}
        <div className="btn-row">
          <button className="btn-s" onClick={onOptimize} disabled={points.length < 4} title="Reordena as paradas pelo menor caminho">Otimizar ordem</button>
          <button className="btn-s" onClick={onUndo} disabled={!canUndo} title="Ctrl+Z">Desfazer</button>
          <button className="btn-s" onClick={copyLink} disabled={!points.length}>{copied ? 'Link copiado' : 'Copiar link do plano'}</button>
          <button className="btn-s" onClick={onClear} disabled={!points.length}>Limpar</button>
        </div>
        <div className="btn-row">
          <button className="btn-s ghost" onClick={onExample}>Carregar exemplo</button>
          <button className="btn-s ghost" onClick={onExampleExt}>Exemplo até os boxworks</button>
        </div>
        {status && <p className={`status ${router.status}`}>{status}</p>}
      </section>

      {hasRoute && (
        <>
          <section aria-label="Alertas" className="alerts">
            {plan.alerts.map((a, i) => (
              <div key={i} className={`alert ${a.level}`}>
                {a.text}
                {a.action && <button className="btn-s fix" onClick={() => onFix(a.action.id, a.action.lat, a.action.lon)}>{a.action.label}</button>}
              </div>
            ))}
          </section>

          <section aria-label="Resumo">
            <div className="budget" aria-label="Tempo da saída em relação ao limite">
              <div className="budget-bar"><span style={{ width: `${Math.min(100, usedPct * 100)}%` }} className={plan.isOver ? 'over' : usedPct > 0.85 ? 'tight' : ''} /></div>
              <div className="budget-txt"><b>{fmtDur(plan.totalH)}</b> de {fmtDur(limitH)} · volta às {fmtClock(startHour + plan.totalH)}</div>
            </div>
            <div className="stats">
              <div className="stat"><b>{fmtKm(plan.out)}</b><span>distância de ida</span></div>
              <div className="stat"><b>{fmtKm(plan.total)}</b><span>{plan.retLegs.length ? 'total com retorno' : 'total'}</span></div>
              <div className="stat"><b>+{Math.round(plan.up)} m</b><span>subida na ida</span></div>
              <div className="stat"><b>{fmtDeg(plan.maxSlope)}</b><span>declive máximo</span></div>
              <div className="stat"><b>{fmtKm(plan.walkKm)}</b><span>a pé</span></div>
              <div className="stat"><b>{Math.round((1 - plan.noRadio) * 100)}%</b><span>com contato de rádio</span></div>
            </div>
            <p className="note" style={{ marginTop: 8 }}>{plan.notes.join(' ')}</p>
          </section>

          <section>
            <h2>Cronograma</h2>
            <div className="table-wrap">
              <table className="legs">
                <thead><tr><th>Parada</th><th className="n">Chega</th><th className="n">Sai</th><th className="n" title="Tempo para voltar a pé ao habitat a partir da parada">Volta a pé</th></tr></thead>
                <tbody>
                  {plan.schedule.map((s) => {
                    const late = s.leave + (s.back ?? 0) > limitH
                    return (
                      <tr key={s.id} className={late ? 'blk' : ''}>
                        <td>{order(s.id)}. {s.short}</td>
                        <td className="n">{fmtClock(startHour + s.arrive)}</td>
                        <td className="n">{fmtClock(startHour + s.leave)}</td>
                        <td className="n">{s.back == null ? '…' : fmtDur(s.back)}</td>
                      </tr>
                    )
                  })}
                  {returnHome && <tr><td>Habitat</td><td className="n">{fmtClock(startHour + plan.totalH)}</td><td className="n">—</td><td className="n">—</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>Trechos</h2>
            <div className="table-wrap">
              <table className="legs">
                <thead><tr><th>Trecho</th><th className="n">Dist.</th><th className="n">Tempo</th><th className="n">Subida</th><th className="n">Decl.</th></tr></thead>
                <tbody>
                  {plan.legs.map((l) => row(l, `${short(l.from)} → ${short(l.to)}`))}
                  {plan.retLegs.map((l) => row(l, `${short(l.from)} → ${short(l.to)} (volta)`))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>Perfil de altitude da ida</h2>
            <Profile legs={plan.legs} label={(id) => { const i = order(id); return i < 0 ? 'D' : i === 0 ? 'H' : String(i) }} />
            <p className="note">Altitude (m) pela distância percorrida, lida do relevo.</p>
          </section>
        </>
      )}

      <section>
        <h2>Pontos de interesse científico</h2>
        <div className="mission">
          <div className="eyebrow">Objetivo sugerido</div>
          <p><strong>Seguir a água do Monte Sharp:</strong> subir a montanha é andar para a frente no tempo. Cada ponto é um capítulo da história da água em Marte.</p>
        </div>
        <div className="stops" style={{ marginTop: 10 }}>
          {STOPS.filter((s) => s.id !== 'H').map((s) => (
            <article key={s.id} className="stop" data-off={!inRoute.has(s.id)}>
              <span className="num">{s.id}</span>
              <div className="body">
                <button className="go" onClick={() => onFocus(s.id)} title="Ver no mapa"><strong>{s.name}</strong></button>
                <span className="ch">{s.ch}</span>
                <span className="txt">{s.sci}</span>
                <span className="qa"><b>Pergunta</b>{s.q}</span>
                <span className="qa"><b>Tarefa</b>{s.task}</span>
                <details className="why">
                  <summary>Por que esse ponto importa</summary>
                  <span className="qa"><b>Importância</b>{s.imp}</span>
                  <span className="qa"><b>O que o torna interessante</b>{s.int}</span>
                </details>
                {s.risk && <span className="risk">{s.risk}</span>}
                <button className={`btn-s add ${inRoute.has(s.id) ? 'on' : ''}`} onClick={() => onTogglePoi(s.id)}>
                  {inRoute.has(s.id) ? `Na rota (${order(s.id)}ª parada) · remover` : '+ Adicionar à rota'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Legenda</h2>
        <div className="legend">
          <span><i style={{ background: 'var(--route)' }} />A pé</span>
          <span><i style={{ background: 'var(--vehicle)' }} />Veículo</span>
          <span><i style={{ background: 'var(--hazard)' }} />Acima do limite de declive</span>
          <span><i className="dots" />Sem contato de rádio com o habitat</span>
          <span><i style={{ background: 'rgba(60,200,120,.7)' }} />Ida e volta em até metade do limite</span>
          <span><i style={{ background: 'rgba(240,200,60,.7)' }} />Até 3/4 do limite</span>
          <span><i style={{ background: 'rgba(240,130,40,.7)' }} />Até o limite</span>
          <span><i style={{ background: 'rgba(0,0,0,.5)' }} />Fora de alcance</span>
          <span><i style={{ background: 'var(--rover)', opacity: 0.8 }} />{DATASET.roverLabel}</span>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          A rota é o caminho de menor custo (A*) sobre o {DATASET.demLabel}, calculado no navegador. O custo pesa declividade e rugosidade{DATASET.hazard ? ' e a zona de rochas cortantes (posição aproximada)' : ''}. Limite de declive (perfil conservador): {router.meta?.limits?.walk ?? 15}° a pé e {router.meta?.limits?.car ?? 15}° de veículo; acima disso o terreno é tratado como intransitável. {DATASET.vehicleRule.replace('De veículo, 15°', 'De veículo').replace('De veículo.', '').replace('De veículo, com', 'O veículo tem')}
          {' '}O tempo usa a velocidade em função do declive (função de Tobler, limitada a 3,6 km/h pelo traje). O alcance considera ida e volta pelo caminho mais rápido. O rádio considera linha de visada entre uma antena de 10 m no habitat e o traje, sobre o relevo. Blocos menores que a resolução do relevo não aparecem.
        </p>
      </section>

      <section className="src">
        <h2>Fontes</h2>
        {DATASET.sources.map(([what, name, url, org]) => (
          <span key={what}>{what}: <a href={url} target="_blank" rel="noopener">{name}</a> ({org})</span>
        ))}
      </section>
    </aside>
  )
}
