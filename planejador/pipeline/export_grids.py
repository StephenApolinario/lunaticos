"""Exporta as grades que o app usa para calcular rotas no navegador.

Uso: python pipeline/export_grids.py data app/public            (versão ampliada, grade de 2 m)
     python pipeline/export_grids.py data_hk app/public/hk --strict   (versão hackathon, grade de 4 m)

Gera em <saída>/grid/:
  meta.json       dimensões, georreferência e escalas
  cost_walk.bin   custo a pé por célula (Uint8: custo×10; 255 = intransitável)
  cost_car.bin    custo de veículo por célula (idem)
  slope.bin       declividade suavizada (Uint8: graus×4)
  height.bin      altitude (Uint16: decímetros acima do mínimo)
"""
import json, math, os, sys
import numpy as np
from scipy import ndimage

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
STRICT = "--strict" in sys.argv  # sem zona de rochas estimada e sem preferência pelo trajeto do rover
D, WEB = ARGS[0], ARGS[1]
out = os.path.join(WEB, "grid"); os.makedirs(out, exist_ok=True)

dem = np.load(f"{D}/dem2m.npy")
g = json.load(open(f"{D}/dem2m.json"))
R, ULX, ULY, r0, c0, ST = g["R"], g["ULX"], g["ULY"], g["r0"], g["c0"], g["step"]
H, W = dem.shape
PX = float(ST)

def to_px(lat, lon):
    return (ULY - R * math.radians(lat) - r0) / ST, (R * math.radians(lon) - ULX - c0) / ST

nan = np.isnan(dem)
if nan.any():
    idx = ndimage.distance_transform_edt(nan, return_distances=False, return_indices=True)
    dem = dem[tuple(idx)]

gy, gx = np.gradient(dem, PX)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
slope_s = ndimage.uniform_filter(slope, 3)
win = max(3, int(round(10 / PX)) | 1)  # janela de ~10 m
rough = np.abs(dem - ndimage.uniform_filter(dem, win))

# Corredor do Curiosity e zona de rochas cortantes (só na versão ampliada)
dist_trav = np.full(dem.shape, np.inf)
gator = np.zeros(dem.shape, bool)
if not STRICT:
    mask = np.ones(dem.shape, bool)
    for lat, lon, *_ in json.load(open(f"{D}/traverse.json")):
        i, j = (int(round(v)) for v in to_px(lat, lon))
        if 0 <= i < H and 0 <= j < W:
            mask[i, j] = False
    dist_trav = ndimage.distance_transform_edt(mask) * PX
    hi, hj = to_px(-4.74867, 137.39095)
    yy, xx = np.ogrid[:H, :W]
    gator = ((yy - hi) ** 2 + (xx - hj) ** 2) * PX * PX < 250 ** 2

PROFILES = {
    # Perfil conservador: 15° a pé e de veículo (margem sobre os ~20° de referência de Apollo/Perseverance)
    "walk": dict(max_slope=15, k_slope=0.08, steep=10, steep_pen=3.0, k_rough=1.5, gator=1.5, corridor=1.0),
    "car": dict(max_slope=15, k_slope=0.12, steep=10, steep_pen=4.0, k_rough=4.0, gator=25.0, corridor=0.55),
}
for name, p in PROFILES.items():
    c = 1 + p["k_slope"] * slope_s + p["k_rough"] * np.clip(rough, 0, 2)
    c += np.where(slope_s > p["steep"], p["steep_pen"], 0)
    c = np.where(gator, c * p["gator"], c)
    c = np.where(dist_trav < 15, c * p["corridor"], c)
    q = np.clip(np.round(c * 10), 1, 254).astype(np.uint8)
    q[(slope_s > p["max_slope"]) | nan] = 255
    q.tofile(f"{out}/cost_{name}.bin")
    print(name, "intransitável:", round(float((q == 255).mean() * 100), 1), "%")

np.clip(np.round(slope_s * 4), 0, 255).astype(np.uint8).tofile(f"{out}/slope.bin")
hmin = float(dem.min())
np.clip(np.round((dem - hmin) * 10), 0, 65535).astype("<u2").tofile(f"{out}/height.bin")
json.dump({"rows": H, "cols": W, "step": PX, "R": R, "ULX": ULX, "ULY": ULY, "r0": r0, "c0": c0,
           "hmin": hmin, "costScale": 10, "slopeScale": 4, "impassable": 255,
           "limits": {k: v["max_slope"] for k, v in PROFILES.items()}},
          open(f"{out}/meta.json", "w"))
print("grade", H, "x", W, "a", PX, "m")
for f in sorted(os.listdir(out)):
    print(" ", f, os.path.getsize(f"{out}/{f}") // 1024, "KB")
