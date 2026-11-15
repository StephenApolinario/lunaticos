"""Rota segura de menor custo sobre o DEM de 2 m (Gale, Monte Sharp).
Uso: python pipeline/route.py data app/public
Lê data/dem2m.npy e data/traverse.json; gera routes.json e slope.json (em data/ e app/public/data/) e app/public/slope.png."""
import json, math, os, sys, numpy as np
from scipy import ndimage
from skimage.graph import route_through_array
import imageio.v3 as iio

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
# --strict: versão só com recursos do hackathon (sem zona de rochas estimada e sem preferência pelo trajeto do rover)
STRICT = "--strict" in sys.argv
D = ARGS[0]
WEB = ARGS[1] if len(ARGS) > 1 else D
dem = np.load(f"{D}/dem2m.npy")
g = json.load(open(f"{D}/dem2m.json"))
R, ULX, ULY, r0, c0, ST = g["R"], g["ULX"], g["ULY"], g["r0"], g["c0"], g["step"]
PX = float(ST)  # metros por pixel
H, W = dem.shape

def to_px(lat, lon):
    i = (ULY - R * math.radians(lat) - r0) / ST
    j = (R * math.radians(lon) - ULX - c0) / ST
    return int(round(i)), int(round(j))

def to_ll(i, j):
    lat = math.degrees((ULY - (r0 + i * ST + ST / 2)) / R)
    lon = math.degrees((c0 + j * ST + ST / 2 + ULX) / R)
    return lat, lon

nan = np.isnan(dem)
if nan.any():  # preenche buracos com o vizinho mais próximo (e marca como intransitável)
    idx = ndimage.distance_transform_edt(nan, return_distances=False, return_indices=True)
    dem = dem[tuple(idx)]

# Declividade (graus) e rugosidade (desvio local em relação à média 5x5 = 10 m)
gy, gx = np.gradient(dem, PX)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
slope_s = ndimage.uniform_filter(slope, 3)
rough = np.abs(dem - ndimage.uniform_filter(dem, 5))

# Corredor do Curiosity (terreno já percorrido por um veículo)
T = json.load(open(f"{D}/traverse.json"))
mask = np.ones_like(dem, dtype=bool)
for lat, lon, *_ in T:
    i, j = to_px(lat, lon)
    if 0 <= i < H and 0 <= j < W:
        mask[i, j] = False
dist_trav = ndimage.distance_transform_edt(mask) * PX  # metros até o trajeto

# Zona de rochas cortantes (aproximada)
hi, hj = to_px(-4.74867, 137.39095)
yy, xx = np.ogrid[:H, :W]
gator = ((yy - hi) ** 2 + (xx - hj) ** 2) * PX * PX < 250 ** 2
if STRICT:
    gator[:] = False
    dist_trav[:] = np.inf

PROFILES = {
    # a pé com traje: limite de 20°, penaliza acima de 12°
    "walk": dict(max_slope=20, k_slope=0.08, steep=12, steep_pen=3.0, k_rough=1.5, gator=1.5, corridor=1.0),
    # veículo: limite de 15°, rugosidade pesa mais, evita gator-back, prefere o corredor do rover
    "car": dict(max_slope=15, k_slope=0.12, steep=10, steep_pen=4.0, k_rough=4.0, gator=25.0, corridor=0.55),
}

def cost_grid(p):
    c = 1 + p["k_slope"] * slope_s + p["k_rough"] * np.clip(rough, 0, 2)
    c += np.where(slope_s > p["steep"], p["steep_pen"], 0)
    c = np.where(gator, c * p["gator"], c)
    c = np.where(dist_trav < 15, c * p["corridor"], c)
    c[(slope_s > p["max_slope"]) | nan] = 1e6  # intransitável
    return c

STOPS = [("H", -4.7288545, 137.3836581), ("1", -4.73706071, 137.3807898), ("2", -4.77647482, 137.4045524),
         ("3", -4.78570678, 137.408864), ("4", -4.804189, 137.3796858), ("5", -4.81155245, 137.3818117)]
SP = {s[0]: s for s in STOPS}

def snap(i, j, c):
    """Se o ponto cair em célula intransitável, move para a transitável mais próxima."""
    if c[i, j] < 1e6:
        return i, j
    ok = c < 1e6
    _, (ii, jj) = ndimage.distance_transform_edt(~ok, return_indices=True)
    return int(ii[i, j]), int(jj[i, j])

def leg(c, a, b):
    s = snap(*to_px(*SP[a][1:]), c); e = snap(*to_px(*SP[b][1:]), c)
    path, _ = route_through_array(c, s, e, fully_connected=True, geometric=True)
    path = np.array(path)
    z = dem[path[:, 0], path[:, 1]]
    seg = np.hypot(np.diff(path[:, 0]) * PX, np.diff(path[:, 1]) * PX)
    seg3 = np.hypot(seg, np.diff(z))
    sl = slope_s[path[:, 0], path[:, 1]]
    keep = np.r_[0:len(path):5, len(path) - 1]  # 1 ponto a cada ~10 m
    coords = [[round(v, 6) for v in to_ll(i, j)] for i, j in path[keep]]
    return {
        "from": a, "to": b, "coords": coords,
        "len_km": round(float(seg3.sum()) / 1000, 3),
        "gain_m": round(float(np.clip(np.diff(z), 0, None).sum())),
        "loss_m": round(float(np.clip(-np.diff(z), 0, None).sum())),
        "max_slope": round(float(sl.max()), 1),
        "p95_slope": round(float(np.percentile(sl, 95)), 1),
        "blocked": bool((c[path[:, 0], path[:, 1]] >= 1e6).any()),
        "profile": [round(float(v)) for v in z[keep]],
    }

out = {"grid": {"m_per_px": PX, "shape": [H, W]}}
for name, p in PROFILES.items():
    c = cost_grid(p)
    seq = ["H", "1", "2", "3", "4", "5"]
    legs = [leg(c, seq[k], seq[k + 1]) for k in range(len(seq) - 1)]
    out[name] = {"legs": legs, "return_base": leg(c, "3", "H"), "return_ext": leg(c, "5", "H")}
    for l in legs + [out[name]["return_base"], out[name]["return_ext"]]:
        print(name, l["from"], "->", l["to"], l["len_km"], "km", "+", l["gain_m"], "m", "max", l["max_slope"], "p95", l["p95_slope"], "blocked" if l["blocked"] else "")

os.makedirs(f"{WEB}/data", exist_ok=True)
stops_el = {s: round(float(dem[to_px(a_, b_)]), 1) for s, a_, b_ in STOPS}  # altitude das paradas lida do relevo
for d in (D, f"{WEB}/data"):
    json.dump(stops_el, open(f"{d}/stops.json", "w"))
for d in (D, f"{WEB}/data"):
    json.dump(out, open(f"{d}/routes.json", "w"), separators=(",", ":"))

# Camada de declividade: transparente < 10°, amarelo 10–15°, laranja 15–20°, vermelho > 20°
s2 = slope_s[::2, ::2] if PX < 3 else slope_s
rgba = np.zeros(s2.shape + (4,), np.uint8)
for lo, hi_, col in [(10, 15, (245, 200, 60, 45)), (15, 20, (240, 130, 40, 80)), (20, 90, (225, 50, 50, 115))]:
    m = (s2 >= lo) & (s2 < hi_)
    rgba[m] = col
iio.imwrite(f"{WEB}/slope.png", rgba)
tl = to_ll(-0.5, -0.5); br = to_ll(H - 0.5, W - 0.5)
for d in (D, f"{WEB}/data"):
    json.dump({"bounds": [[br[0], tl[1]], [tl[0], br[1]]]}, open(f"{d}/slope.json", "w"))
print("slope stats: >15°", round(float((slope_s > 15).mean() * 100), 1), "%  >20°", round(float((slope_s > 20).mean() * 100), 1), "%")
