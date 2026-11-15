/** Perfil de altitude da ida, a partir dos perfis de cada trecho calculado. */
export default function Profile({ legs, label = (id) => id }) {
  if (!legs.length) return null
  const xs = [], ys = [], marks = [{ id: legs[0].from, x: 0, y: legs[0].profile[0] }]
  let x0 = 0
  for (const l of legs) {
    const p = l.profile, k = p.length - 1 || 1
    p.forEach((v, i) => { xs.push(x0 + (l.len_km * i) / k); ys.push(v) })
    x0 += l.len_km
    marks.push({ id: l.to, x: x0, y: p[p.length - 1] })
  }
  const W = 380, H = 150, pl = 40, pr = 12, pt = 12, pb = 22
  const xmax = x0 || 1
  const ymin = Math.floor(Math.min(...ys) / 100) * 100, ymax = Math.max(ymin + 100, Math.ceil(Math.max(...ys) / 100) * 100)
  const X = (v) => pl + (v / xmax) * (W - pl - pr)
  const Y = (v) => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb)
  const d = 'M' + xs.map((x, i) => `${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('L')
  const area = `${d}L${X(xmax)},${H - pb}L${X(0)},${H - pb}Z`
  const yTicks = []; for (let v = ymin; v <= ymax; v += 100) yTicks.push(v)
  const step = xmax > 8 ? 2 : xmax > 3 ? 1 : 0.5
  const xTicks = []; for (let v = 0; v <= xmax + 1e-9; v += step) xTicks.push(v)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Altitude ao longo da rota calculada" className="profile-svg">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
          <text x={pl - 4} y={Y(v) + 3} textAnchor="end">{v}</text>
        </g>
      ))}
      {xTicks.map((v) => <text key={v} x={X(v)} y={H - 6} textAnchor="middle">{String(v).replace('.', ',')} km</text>)}
      <path d={area} fill="var(--accent)" fillOpacity=".12" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={X(m.x)} cy={Y(m.y)} r="8" fill={i === 0 ? 'var(--accent)' : 'var(--fg)'} />
          <text x={X(m.x)} y={Y(m.y) + 3} textAnchor="middle" className="mark">{label(m.id, i)}</text>
        </g>
      ))}
    </svg>
  )
}
