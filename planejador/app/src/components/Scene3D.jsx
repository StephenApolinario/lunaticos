import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STOP, HAZARD } from '../data/stops'
import { DATASET } from '../dataset'
import { badRuns, sampleTimeline, reachAt, fmtDur, fmtClock as fmtClk, MODE_LABEL } from '../lib/plan'
import { hv } from '../lib/geo'

const COL = { walk: 0x16c2d5, car: 0xf5c04a, hazard: 0xef4a4f, habitat: 0xec7a45, custom: 0x7c5cff }
const FOG = 0xcfa684

// Relevo e metadados: carregados uma vez e reaproveitados entre as trocas de visão
let terrainData = null
function loadTerrain() {
  terrainData ??= Promise.all([
    fetch(`${DATASET.base}/3d/scene.json`).then((r) => r.json()),
    fetch(`${DATASET.base}/3d/height.bin`).then((r) => r.arrayBuffer()),
  ]).then(([scene, buf]) => ({ ...scene, h16: new Uint16Array(buf) }))
  return terrainData
}

// Céu marciano: gradiente do horizonte claro para um topo mais escuro
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256)
  gr.addColorStop(0, '#5e3f2b'); gr.addColorStop(0.55, '#a77b58'); gr.addColorStop(0.85, '#d7b08a'); gr.addColorStop(1, '#e2c09c')
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Posição do Sol a partir da hora local (simplificada: nasce a leste, passa ao norte, põe a oeste)
function sunDir(hour) {
  const el = THREE.MathUtils.degToRad(Math.max(4, 72 * Math.sin((Math.PI * (hour - 6)) / 12)))
  const az = THREE.MathUtils.degToRad(90 - ((hour - 6) / 12) * 180) // a partir do norte, sentido horário
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize()
}
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}h${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export default function Scene3D({ traverse, points, plan, mode, focus, onAdd, startHour, setStartHour, limitH, reachWalk, meta }) {
  const canvas = useRef(null)
  const labelBox = useRef(null)
  const needle = useRef(null)
  const readout = useRef(null)
  const api = useRef(null)
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd
  const [exag, setExag] = useState(2)
  const [exagDraft, setExagDraft] = useState(2)
  const [simT, setSimT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(300) // segundos simulados por segundo real
  const [cam, setCam] = useState('free')
  const [hud, setHud] = useState(null)
  const [, setFlying] = useState(false)
  const [status, setStatus] = useState('Carregando relevo e imagem HiRISE…')

  // Cena, terreno e laço de renderização
  useEffect(() => {
    let disposed = false, raf = 0
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    const scene = new THREE.Scene()
    scene.background = skyTexture()
    scene.fog = new THREE.Fog(FOG, 5000, 17000)
    const camera = new THREE.PerspectiveCamera(45, 1, 5, 60000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 60
    controls.maxDistance = 14000
    controls.zoomToCursor = true
    scene.add(new THREE.HemisphereLight(0xf3dcc4, 0x2b1e15, 0.55))
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.8)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 2.5
    scene.add(sun, sun.target)
    const overlay = new THREE.Group()
    scene.add(overlay)
    // Marcador do astronauta (em escala ampliada para ser visível de longe)
    const astro = new THREE.Group()
    const suit = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.55, emissive: 0x2a1a10 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(4, 10, 4, 12), suit)
    body.position.y = 9
    const visor = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd98a2b, metalness: 0.6, roughness: 0.25 }))
    visor.position.set(0, 16.5, 2.4)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(7, 9, 3), suit)
    pack.position.set(0, 11, -4.5)
    const halo = new THREE.Mesh(new THREE.RingGeometry(10, 14, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false }))
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 1.5
    astro.add(body, visor, pack, halo)
    astro.visible = false
    scene.add(astro)

    const resize = () => {
      const p = canvas.current?.parentElement
      if (!p) return
      renderer.setSize(p.clientWidth, p.clientHeight, false)
      camera.aspect = p.clientWidth / p.clientHeight
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.current.parentElement)

    const st = { renderer, scene, camera, controls, overlay, sun, labels: {}, stopPos: {}, fly: null, tween: null, exag: 2, hour: startHour, startHour, meshes: [], sim: { t: 0, playing: false, speed: 300, cam: 'free' }, timeline: [], totalH: 0 }
    api.current = st
    const uniforms = { uGrad: { value: null }, uExag: { value: 2 }, uGradSize: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() } }

    loadTerrain().then(async (T) => {
      if (disposed) return
      const { rows, cols, cell, hmin, bounds } = T.grid
      const [[latBot, lonL], [latTop, lonR]] = bounds
      const h16 = T.h16
      const Wm = (cols - 1) * cell, Hm = (rows - 1) * cell, ox = Wm / 2, oz = Hm / 2
      const hRaw = (i, j) => h16[i * cols + j] / 10
      const hAt = (x, z) => { // x, z em metros a partir do vértice (0,0)
        const fj = Math.min(Math.max(x / cell, 0), cols - 1.001), fi = Math.min(Math.max(z / cell, 0), rows - 1.001)
        const j = Math.floor(fj), i = Math.floor(fi), tx = fj - j, tz = fi - i
        return (hRaw(i, j) * (1 - tx) + hRaw(i, j + 1) * tx) * (1 - tz) + (hRaw(i + 1, j) * (1 - tx) + hRaw(i + 1, j + 1) * tx) * tz
      }
      const toM = (lat, lon) => [((lon - lonL) / (lonR - lonL)) * Wm, ((latTop - lat) / (latTop - latBot)) * Hm]
      const toLL = (x, z) => [latTop - (z / Hm) * (latTop - latBot), lonL + (x / Wm) * (lonR - lonL)]
      Object.assign(st, { rows, cols, cell, hmin, ox, oz, Wm, Hm, hAt, toM, toLL, h16 })

      // Inclinação na resolução do DEM: usada no shader para a luz ver detalhe fino
      const loader = new THREE.TextureLoader()
      const grad = await loader.loadAsync(`${DATASET.base}/3d/${T.grad.file}`)
      grad.colorSpace = THREE.NoColorSpace
      grad.anisotropy = renderer.capabilities.getMaxAnisotropy()
      uniforms.uGrad.value = grad
      uniforms.uGradSize.value.set(T.grad.cols * T.grad.step, T.grad.rows * T.grad.step)
      uniforms.uOff.value.set(ox + T.grad.offset, oz + T.grad.offset)

      // Uma malha por faixa de textura
      const texs = await Promise.all(T.bands.map((b) => loader.loadAsync(`${DATASET.base}/3d/${b.tex}`)))
      if (disposed) return
      T.bands.forEach((b, k) => {
        const nr = b.r1 - b.r0 + 1
        const pos = new Float32Array(nr * cols * 3), uv = new Float32Array(nr * cols * 2), nrm = new Float32Array(nr * cols * 3)
        for (let r = 0; r < nr; r++) for (let j = 0; j < cols; j++) {
          const k2 = r * cols + j, i = b.r0 + r
          pos[k2 * 3] = j * cell - ox; pos[k2 * 3 + 2] = i * cell - oz
          uv[k2 * 2] = j / (cols - 1); uv[k2 * 2 + 1] = 1 - r / (nr - 1)
        }
        const idx = new Uint32Array((nr - 1) * (cols - 1) * 6)
        let p = 0
        for (let r = 0; r < nr - 1; r++) for (let j = 0; j < cols - 1; j++) {
          const a = r * cols + j, bb = a + 1, c = a + cols, d = c + 1
          idx[p++] = a; idx[p++] = c; idx[p++] = bb; idx[p++] = bb; idx[p++] = c; idx[p++] = d
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
        geo.setIndex(new THREE.BufferAttribute(idx, 1))
        const tex = texs[k]
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })
        mat.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, uniforms)
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uGrad;\nuniform float uExag;\nuniform vec2 uGradSize;\nuniform vec2 uOff;')
            .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  vec2 gUv = vec2((vWPos.x + uOff.x) / uGradSize.x, 1.0 - (vWPos.z + uOff.y) / uGradSize.y);
  vec2 gr = (texture2D(uGrad, gUv).rg - 0.5) * 4.0;
  vec3 nW = normalize(vec3(-gr.x * uExag, 1.0, -gr.y * uExag));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
        }
        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow = true; mesh.receiveShadow = true
        mesh.userData.band = b
        scene.add(mesh)
        st.meshes.push(mesh)
      })

      st.applyExag = (e) => {
        st.exag = e
        uniforms.uExag.value = e
        for (const m of st.meshes) {
          const { r0 } = m.userData.band
          const pos = m.geometry.attributes.position.array, nrm = m.geometry.attributes.normal.array
          const n = pos.length / 3
          for (let k = 0; k < n; k++) {
            const r = Math.floor(k / cols), j = k - r * cols, i = r0 + r
            pos[k * 3 + 1] = hRaw(i, j) * e
            // normal analítica (a mesma nas bordas entre faixas)
            const dx = ((hRaw(i, Math.min(cols - 1, j + 1)) - hRaw(i, Math.max(0, j - 1))) / (2 * cell)) * e
            const dz = ((hRaw(Math.min(rows - 1, i + 1), j) - hRaw(Math.max(0, i - 1), j)) / (2 * cell)) * e
            const L = Math.hypot(dx, 1, dz)
            nrm[k * 3] = -dx / L; nrm[k * 3 + 1] = 1 / L; nrm[k * 3 + 2] = -dz / L
          }
          m.geometry.attributes.position.needsUpdate = true
          m.geometry.attributes.normal.needsUpdate = true
          m.geometry.computeBoundingSphere()
          m.geometry.computeBoundingBox()
        }
        st.applySun(st.hour)
      }
      st.applySun = (h) => {
        st.hour = h
        const d = sunDir(h), D = 12000
        sun.target.position.set(0, st.exag * 450, 0)
        sun.position.copy(sun.target.position).addScaledVector(d, D)
        const half = Math.hypot(Wm, Hm) / 2 + 200
        Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 100, far: D * 2 })
        sun.shadow.camera.updateProjectionMatrix()
        // luz mais quente e fraca perto do horizonte
        const el = Math.asin(d.y)
        sun.intensity = 1.2 + 1.8 * Math.min(1, el / 0.6)
        sun.color.setHSL(0.08, 0.6, 0.62 + 0.3 * Math.min(1, el / 0.8))
        renderer.shadowMap.needsUpdate = true
      }
      st.applyExag(st.exag)
      st.ready = true
      st.rebuild?.()
      st.overview(false)
      setStatus('')
    })

    st.W3 = (x, z, lift = 0) => new THREE.Vector3(x - st.ox, st.hAt(x, z) * st.exag + lift, z - st.oz)
    // Animação suave da câmera
    st.moveTo = (target, position, ms = 900) => {
      st.tween = { t0: performance.now(), ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: position }
    }
    st.overview = (animate = true) => {
      const pts = st.flyPts && st.flyPts.length > 1 ? st.flyPts : [[st.Wm * 0.25, st.Hm * 0.05], [st.Wm * 0.75, st.Hm * 0.55]]
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
      const c = st.W3((x0 + x1) / 2, (z0 + z1) / 2)
      const span = Math.max(800, Math.hypot(x1 - x0, z1 - z0))
      const pos = c.clone().add(new THREE.Vector3(-0.55, 0.62, 0.55).normalize().multiplyScalar(span * 1.35))
      if (animate) st.moveTo(c, pos)
      else { controls.target.copy(c); camera.position.copy(pos); controls.update() }
    }
    st.lookAt = (lat, lon) => {
      const [x, z] = st.toM(lat, lon)
      const c = st.W3(x, z)
      const off = camera.position.clone().sub(controls.target).setLength(900)
      off.y = Math.max(off.y, 350)
      st.moveTo(c, c.clone().add(off))
    }

    // Ponto do terreno sob o cursor: marcha ao longo do raio sobre a grade de altura
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    st.pick = (cx, cy) => {
      if (!st.ready) return null
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const o = ray.ray.origin, d = ray.ray.direction
      let prev = 0, step = 8
      for (let t = 0; t < 40000; t += step) {
        const x = o.x + d.x * t + st.ox, z = o.z + d.z * t + st.oz
        const inside = x >= 0 && z >= 0 && x <= st.Wm && z <= st.Hm
        if (inside && o.y + d.y * t <= st.hAt(x, z) * st.exag) {
          let a = prev, b = t
          for (let k = 0; k < 20; k++) {
            const m = (a + b) / 2
            if (o.y + d.y * m <= st.hAt(o.x + d.x * m + st.ox, o.z + d.z * m + st.oz) * st.exag) b = m
            else a = m
          }
          return { x: o.x + d.x * b + st.ox, z: o.z + d.z * b + st.oz }
        }
        prev = t; step = Math.min(40, step * 1.05)
      }
      return null
    }

    const clock = new THREE.Clock(), v3 = new THREE.Vector3(), dir = new THREE.Vector3()
    let lastFwd = new THREE.Vector3(0, 0, -1)
    const frame = () => {
      const dt = clock.getDelta()
      const S = st.sim
      const simOn = st.ready && st.timeline.length > 1
      if (simOn) {
        if (S.playing) {
          S.t = Math.min(st.totalH, S.t + (dt * S.speed) / 3600)
          if (S.t >= st.totalH) { S.playing = false; st.onSimEnd?.() }
        }
        const p = sampleTimeline(st.timeline, S.t)
        const [x, z] = st.toM(p.lat, p.lon)
        const pos = st.W3(x, z)
        const ah = sampleTimeline(st.timeline, Math.min(st.totalH, S.t + 0.03))
        const [ax, az] = st.toM(ah.lat, ah.lon)
        const fwd = new THREE.Vector3(ax - x, 0, az - z)
        if (fwd.lengthSq() > 4) lastFwd = fwd.normalize()
        astro.position.copy(pos)
        astro.rotation.y = Math.atan2(lastFwd.x, lastFwd.z)
        astro.visible = S.cam !== 'helmet'
        if (S.helmetShown !== (S.cam === 'helmet')) {
          S.helmetShown = S.cam === 'helmet'
          for (const o of overlay.children) {
            if (o.userData.tube) o.visible = !S.helmetShown
            if (o.userData.thin) o.visible = S.helmetShown
          }
        }
        if (S.cam === 'helmet') {
          const eye = pos.clone(); eye.y += 2 * st.exag + 1.5
          camera.position.lerp(eye, 0.3)
          const lx = x + lastFwd.x * 70, lz = z + lastFwd.z * 70
          const look = new THREE.Vector3(lx - st.ox, st.hAt(lx, lz) * st.exag + 2 * st.exag, lz - st.oz)
          controls.target.lerp(look, 0.2)
          camera.lookAt(controls.target)
        } else if (S.cam === 'follow') {
          const want = pos.clone().addScaledVector(lastFwd, -320)
          want.y = pos.y + 220 * Math.sqrt(st.exag)
          camera.position.lerp(want, 0.06)
          controls.target.lerp(pos, 0.12)
          camera.lookAt(controls.target)
        }
        const hNow = st.startHour + S.t
        if (Math.abs(hNow - st.hour) > 0.05) st.applySun(hNow)
        const now = performance.now()
        if (now - (S.lastHud || 0) > 100) { S.lastHud = now; st.emitHud?.(p, S.t, x, z) }
      } else {
        astro.visible = false
        if (S.helmetShown) { S.helmetShown = false; for (const o of overlay.children) { if (o.userData.tube) o.visible = true; if (o.userData.thin) o.visible = false } }
      }
      if (simOn && S.cam !== 'free') { /* câmera controlada pela simulação */ } else if (st.fly) {
        const f = st.fly
        f.t += dt / f.dur
        if (f.t >= 1) st.stopFly()
        else {
          const a = f.curve.getPointAt(f.t), b = f.curve.getPointAt(Math.min(1, f.t + 0.025))
          const fwd = b.clone().sub(a).setY(0).normalize()
          camera.position.set(a.x - fwd.x * 260, a.y + 170 * Math.sqrt(st.exag), a.z - fwd.z * 260)
          camera.lookAt(b.x, b.y + 20, b.z)
          controls.target.copy(b)
        }
      } else if (st.tween) {
        const tw = st.tween, k = Math.min(1, (performance.now() - tw.t0) / tw.ms), e = ease(k)
        controls.target.lerpVectors(tw.ft, tw.tt, e)
        camera.position.lerpVectors(tw.fp, tw.tp, e)
        controls.update()
        if (k >= 1) st.tween = null
      } else controls.update()
      renderer.render(scene, camera)
      // bússola: 0° quando a câmera olha para o norte (-z)
      camera.getWorldDirection(dir)
      if (needle.current) needle.current.style.transform = `rotate(${(Math.atan2(dir.x, -dir.z) * -180) / Math.PI}deg)`
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight
      for (const id in st.labels) {
        const el = st.labels[id], sp = st.stopPos[id]
        if (!sp) { el.style.visibility = 'hidden'; continue }
        v3.copy(sp).project(camera)
        const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1
        el.style.visibility = vis ? 'visible' : 'hidden'
        if (vis) el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px,${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%,-100%)`
      }
      raf = requestAnimationFrame(frame)
    }
    resize()
    frame()

    // Interação: leitura sob o cursor e clique para adicionar ponto
    let down = null, pending = false, last = null
    const el = renderer.domElement
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; st.tween = null; if (st.fly) st.stopFly() }
    const onUp = (e) => {
      if (!down || down.b !== 0) { down = null; return }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return
      const p = st.pick(e.clientX, e.clientY)
      if (p) { const [lat, lon] = st.toLL(p.x, p.z); onAddRef.current?.(lat, lon) }
    }
    const onMove = (e) => {
      last = e
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        const box = readout.current
        if (!box) return
        const p = last && st.pick(last.clientX, last.clientY)
        if (!p) { box.hidden = true; return }
        const [lat, lon] = st.toLL(p.x, p.z)
        const c = st.cell
        const dx = (st.hAt(p.x + c, p.z) - st.hAt(p.x - c, p.z)) / (2 * c), dz = (st.hAt(p.x, p.z + c) - st.hAt(p.x, p.z - c)) / (2 * c)
        const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
        box.hidden = false
        box.innerHTML = `<b>${Math.round(st.hAt(p.x, p.z) + st.hmin)} m</b> · declive <b class="${slope > 20 ? 'hi' : slope > 15 ? 'mid' : ''}">${slope.toFixed(1).replace('.', ',')}°</b><span>${lat.toFixed(5)}, ${lon.toFixed(5)} · clique para adicionar</span>`
      })
    }
    const onLeave = () => { if (readout.current) readout.current.hidden = true }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.() })
      uniforms.uGrad.value?.dispose()
      scene.background?.dispose()
      renderer.dispose()
      api.current = null
    }
  }, [])

  // Rótulos dos pontos escolhidos (DOM sobre o canvas)
  useEffect(() => {
    const box = labelBox.current
    const labels = {}
    points.forEach((p, k) => {
      const el = document.createElement('div')
      el.className = 'lbl3d'
      el.innerHTML = `<b>${k === 0 ? 'H' : k}</b>${p.short}`
      el.style.visibility = 'hidden'
      box.appendChild(el)
      labels[p.id] = el
    })
    if (api.current) api.current.labels = labels
    return () => { box.innerHTML = ''; if (api.current) api.current.labels = {} }
  }, [points])

  // Rota, trajeto, zona de risco e marcadores: refeitos quando o plano ou o exagero mudam
  useEffect(() => {
    const st = api.current
    if (!st) return
    st.rebuild = () => {
      if (!st.ready) return
      const { overlay, W3, toM } = st
      overlay.children.slice().forEach((o) => { overlay.remove(o); o.geometry?.dispose(); o.material?.dispose() })
      st.sim.helmetShown = undefined
      const densify = (pts, step = 6) => {
        if (pts.length < 2) return pts
        const out = []
        for (let k = 0; k < pts.length - 1; k++) {
          const [x1, z1] = pts[k], [x2, z2] = pts[k + 1]
          const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / step))
          for (let t = 0; t < n; t++) out.push([x1 + ((x2 - x1) * t) / n, z1 + ((z2 - z1) * t) / n])
        }
        out.push(pts[pts.length - 1])
        return out
      }
      const ll2m = (coords) => coords.map(([la, lo]) => toM(la, lo))
      const tube = (pts, color, r, lift) => {
        const v = densify(pts).map(([x, z]) => W3(x, z, lift))
        if (v.length < 2) return
        const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal')
        const tm = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(v.length * 2, 4000), r, 6, false), new THREE.MeshBasicMaterial({ color, toneMapped: false }))
        tm.userData.tube = true
        overlay.add(tm)
        // trilha fina, usada na visão do capacete
        const thin = new THREE.Line(new THREE.BufferGeometry().setFromPoints(densify(pts, 3).map(([x, z]) => W3(x, z, 0.6))), new THREE.LineBasicMaterial({ color, toneMapped: false }))
        thin.userData.thin = true
        thin.visible = false
        overlay.add(thin)
      }
      const line = (pts, color, lift, dashed) => {
        const g = new THREE.BufferGeometry().setFromPoints(densify(pts, 8).map(([x, z]) => W3(x, z, lift)))
        const m = dashed
          ? new THREE.LineDashedMaterial({ color, dashSize: 14, gapSize: 12, transparent: true, opacity: 0.85, toneMapped: false })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false })
        const l = new THREE.Line(g, m)
        if (dashed) l.computeLineDistances()
        overlay.add(l)
      }

      const trav = traverse.map((p) => toM(p[0], p[1])).filter(([x, z]) => x >= 0 && z >= 0 && x <= st.Wm && z <= st.Hm)
      if (trav.length > 1) line(trav.filter((_, i) => i % 2 === 0), 0xffffff, 3, true)
      if (DATASET.hazard) {
        const [gx, gz] = toM(HAZARD.lat, HAZARD.lon)
        const ring = Array.from({ length: 65 }, (_, a) => { const t = (a / 64) * Math.PI * 2; return [gx + Math.cos(t) * HAZARD.r * 1000, gz + Math.sin(t) * HAZARD.r * 1000] })
        line(ring, COL.hazard, 4, false)
      }
      const legs = plan?.legs ?? []
      for (const l of legs) {
        tube(ll2m(l.coords), COL[l.mode] ?? COL[mode], 3.5, 5)
        for (const r of badRuns(l, 'bad')) tube(ll2m(r), COL.hazard, 4.5, 6)
        for (const r of badRuns(l, 'los')) line(ll2m(r), 0xc58cff, 12, true)
        if (l.unreachable) line(ll2m([l.coords[l.coords.length - 1], l.unreachable.target]), 0xffffff, 8, true)
      }
      for (const l of plan?.retLegs ?? []) line(ll2m(l.coords), COL[l.mode] ?? COL[mode], 6, true)
      for (const d of plan?.extra ?? []) {
        const [x, z] = toM(d.lat, d.lon), b = W3(x, z)
        const m = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 4, 24), new THREE.MeshBasicMaterial({ color: COL.car, toneMapped: false }))
        m.position.set(b.x, b.y + 3, b.z)
        overlay.add(m)
      }

      st.stopPos = {}
      points.forEach((s, k) => {
        const [x, z] = toM(s.lat, s.lon)
        const base = W3(x, z), hp = 80
        const color = k === 0 ? COL.habitat : s.kind === 'custom' ? COL.custom : 0xffffff
        const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false })
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, hp, 8), mat)
        pole.position.set(base.x, base.y + hp / 2, base.z)
        const ball = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), mat.clone())
        ball.position.set(base.x, base.y + hp, base.z)
        const ring = new THREE.Mesh(new THREE.RingGeometry(14, 20, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }))
        ring.rotation.x = -Math.PI / 2
        ring.position.set(base.x, base.y + 2, base.z)
        overlay.add(pole, ball, ring)
        st.stopPos[s.id] = new THREE.Vector3(base.x, base.y + hp + 14, base.z)
      })
      st.flyPts = legs.flatMap((l) => ll2m(l.coords))
      st.densify = densify
    }
    if (st.ready && st.exag !== exag) st.applyExag(exag)
    st.rebuild()
  }, [plan, points, mode, exag, traverse])

  // Sol: hora de início da saída + tempo simulado
  useEffect(() => {
    const st = api.current
    if (!st) return
    st.startHour = startHour
    if (st.ready) st.applySun(startHour + st.sim.t)
    else st.hour = startHour
  }, [startHour])

  // Linha do tempo da saída
  useEffect(() => {
    const st = api.current
    if (!st) return
    st.timeline = plan?.timeline || []
    st.totalH = plan?.totalH || 0
    if (st.sim.t > st.totalH) { st.sim.t = 0; setSimT(0) }
  }, [plan])
  useEffect(() => {
    const st = api.current
    if (!st) return
    Object.assign(st.sim, { playing, speed, cam })
    st.controls.enabled = cam === 'free'
    if (cam === 'free') st.tween = null
  }, [playing, speed, cam])
  useEffect(() => {
    const st = api.current
    if (!st) return
    st.onSimEnd = () => setPlaying(false)
    st.emitHud = (p, t, x, z) => {
      const pl = plan
      if (!pl) return
      const cur = { lat: p.lat, lon: p.lon }
      const atStop = pl.schedule.find((s) => s.arrive <= t && t < s.leave)
      const next = pl.schedule.find((s) => s.arrive > t)
      const nextPt = next && points.find((q) => q.id === next.id)
      const c = st.cell
      const dx = (st.hAt(x + c, z) - st.hAt(x - c, z)) / (2 * c), dz = (st.hAt(x, z + c) - st.hAt(x, z - c)) / (2 * c)
      const back = reachAt(reachWalk, meta, p.lat, p.lon, 'toHome')
      setSimT(t)
      setHud({
        t, clock: st.startHour + t, mode: p.mode, los: p.los,
        slope: (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI,
        alt: Math.round(st.hAt(x, z) + st.hmin),
        atStop: atStop && { short: atStop.short, left: atStop.leave - t },
        next: next && { short: next.short, km: nextPt ? hv(cur, nextPt) : null, eta: next.arrive - t },
        back, o2: Math.max(0, 1 - t / limitH), danger: back != null && t + back > limitH,
      })
    }
  }, [plan, points, reachWalk, meta, limitH])

  // Sobrevoo
  useEffect(() => {
    const st = api.current
    if (!st) return
    st.stopFly = () => { st.fly = null; st.controls.enabled = true; setFlying(false) }
  }, [])
  const toggleFly = () => {
    const st = api.current
    if (!st?.ready) return
    if (st.fly) return st.stopFly()
    if (!st.flyPts || st.flyPts.length < 2) return
    const v = st.densify(st.flyPts, 20).map(([x, z]) => st.W3(x, z))
    const sm = v.map((_, i) => {
      const a = Math.max(0, i - 6), b = Math.min(v.length - 1, i + 6), s = new THREE.Vector3()
      for (let k = a; k <= b; k++) s.add(v[k])
      return s.divideScalar(b - a + 1)
    })
    st.tween = null
    st.fly = { curve: new THREE.CatmullRomCurve3(sm), t: 0, dur: Math.max(25, ((v.length * 20) / 1000) * 6) }
    st.controls.enabled = false
    setFlying(true)
  }

  // Ir até um ponto
  useEffect(() => {
    const st = api.current
    if (!focus || !st?.ready) return
    st.fly && st.stopFly()
    const s = points.find((p) => p.id === focus.id) || STOP[focus.id]
    if (s) st.lookAt(s.lat, s.lon)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRoute = (plan?.legs?.length ?? 0) > 0
  return (
    <div className="scene3d">
      <canvas ref={canvas} aria-label="Visão 3D do terreno do Monte Sharp; clique para adicionar pontos" />
      <div ref={labelBox} className="labels3d" />
      {status && <div className="scene-status">{status}</div>}
      <div className="scene-ctrl" hidden={cam === 'helmet'}>
        <label className="opt">
          Exagero vertical
          <input type="range" min="1" max="4" step="0.5" value={exagDraft}
            onChange={(e) => setExagDraft(+e.target.value)}
            onPointerUp={() => setExag(exagDraft)} onKeyUp={() => setExag(exagDraft)} />
          <output>{String(exagDraft).replace('.', ',')}×</output>
        </label>
        <label className="opt">
          Início da saída
          <input type="range" min="6" max="14" step="0.25" value={startHour} onChange={(e) => setStartHour(+e.target.value)} />
          <output>{fmtHour(startHour)}</output>
        </label>
        <div className="btns">
          <button className="btn" onClick={() => { setCam('free'); api.current?.stopFly(); api.current?.overview() }}>{hasRoute ? 'Enquadrar rota' : 'Visão geral'}</button>
        </div>
      </div>
      {hasRoute && plan.timeline.length > 1 && (
        <div className="simbar">
          <button className="btn primary play" onClick={() => { if (simT >= plan.totalH - 1e-6) { api.current.sim.t = 0; setSimT(0) } setPlaying((v) => !v); if (cam === 'free') setCam('follow') }} aria-label={playing ? 'Pausar simulação' : 'Simular a saída'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="simtime">
            <input type="range" min="0" max={plan.totalH} step="0.005" value={Math.min(simT, plan.totalH)} aria-label="Momento da saída"
              onChange={(e) => { const v = +e.target.value; api.current.sim.t = v; setSimT(v) }} />
            <div className="simlbl"><b>{fmtClk(startHour + simT)}</b><span>{fmtDur(simT)} de {fmtDur(plan.totalH)}</span></div>
          </div>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Velocidade da simulação">
            <option value={60}>1 min/s</option>
            <option value={300}>5 min/s</option>
            <option value={900}>15 min/s</option>
          </select>
          <div className="seg cam" role="group" aria-label="Câmera">
            <button aria-pressed={cam === 'free'} onClick={() => setCam('free')}>Livre</button>
            <button aria-pressed={cam === 'follow'} onClick={() => setCam('follow')}>Seguir</button>
            <button aria-pressed={cam === 'helmet'} onClick={() => setCam('helmet')}>Capacete</button>
          </div>
        </div>
      )}
      {hasRoute && hud && (simT > 0 || playing || cam !== 'free') && (
        <div className={`hud ${cam === 'helmet' ? 'visor' : ''} ${hud.danger ? 'danger' : ''}`}>
          <div className="hud-row"><span>{hud.mode === 'car' ? '🚙 Veículo' : '🚶 A pé'}</span><b>{fmtClk(hud.clock)}</b></div>
          {hud.atStop
            ? <div className="hud-big">Na parada {hud.atStop.short}<small>{Math.ceil(hud.atStop.left * 60)} min de trabalho</small></div>
            : hud.next
              ? <div className="hud-big">Próxima: {hud.next.short}<small>{hud.next.km != null ? `${hud.next.km.toFixed(2).replace('.', ',')} km · ` : ''}chega em {fmtDur(hud.next.eta)}</small></div>
              : <div className="hud-big">Retorno ao habitat<small>chega em {fmtDur(plan.totalH - hud.t)}</small></div>}
          <div className="hud-grid">
            <div><span>Declive</span><b className={hud.slope > 20 ? 'hi' : hud.slope > 15 ? 'mid' : ''}>{hud.slope.toFixed(0)}°</b></div>
            <div><span>Altitude</span><b>{hud.alt} m</b></div>
            <div><span>Rádio</span><b className={hud.los ? '' : 'hi'}>{hud.los ? 'ok' : 'sem sinal'}</b></div>
            <div><span>Volta a pé</span><b className={hud.danger ? 'hi' : ''}>{hud.back == null ? '…' : fmtDur(hud.back)}</b></div>
          </div>
          <div className="o2"><span>O₂ / tempo de saída</span><div className="o2-bar"><i style={{ width: `${hud.o2 * 100}%` }} className={hud.o2 < 0.2 ? 'low' : ''} /></div><b>{fmtDur(Math.max(0, limitH - hud.t))}</b></div>
          {hud.danger && <div className="hud-alert">Voltar agora: o retorno a pé passa do limite</div>}
        </div>
      )}
      <div className="compass" aria-hidden="true"><div ref={needle} className="needle"><span>N</span></div></div>
      <div ref={readout} className="readout" hidden />
      {points.length < 2 && !status && (
        <div className="map-hint">{points.length === 0 ? 'Clique no terreno para marcar o ponto de partida' : 'Clique no terreno para adicionar uma parada'}</div>
      )}
      <div className="scene-hint">Arraste para girar · botão direito para mover · role para zoom · clique para adicionar ponto</div>
    </div>
  )
}
