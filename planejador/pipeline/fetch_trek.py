"""Versão "só recursos do hackathon": baixa tudo do JPL Mars Trek (trek.nasa.gov).

- Relevo: serviço ArcGIS `Gale_DEM_SMG_1m` (MRO HiRISE, Gale Crater DEM, 1 m), amostrado em grade de 4 m
  com `getSamples` linha a linha (a exportação de recortes do serviço está falhando no servidor).
- Imagem: tiles WMTS de `curiosity_hirise_mosaic` (MRO HiRISE, Curiosity Roving Site Mosaic), montados como textura do 3D.
- Trajeto: serviço `curiosity_path` (trajeto do Curiosity no Mars Trek; termina no Vera Rubin Ridge, 2018).

Uso: python pipeline/fetch_trek.py data_hk      (~10 min; retoma de onde parou se interrompido)
Gera em data_hk/: dem2m.npy (grade de 4 m), dem2m.json, traverse.json, texture_src.png
"""
import io, json, math, os, sys, threading, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import requests
from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
SVC = "https://trek.nasa.gov/mars/trekarcgis/rest/services"
TILES = "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm"
R = 3396190.0  # raio dos produtos do Mars Trek (Mars 2000, esfera)
M2DEG = 180 / (math.pi * R)

# Mesma área da versão principal, grade de 4 m (pontos nos centros das células)
STEP = 4.0
LON0, LAT1 = 137.370, -4.720
W, H = 711, 1482
LON1 = LON0 + (W - 1) * STEP * M2DEG
LAT0 = LAT1 - (H - 1) * STEP * M2DEG
tl = threading.local()


def sess():
    if not hasattr(tl, "s"):
        tl.s = requests.Session()
    return tl.s


# 1. Relevo: uma linha da grade por chamada (getSamples com sampleCount)
cache = f"{out}/dem_rows.npy"
dem = np.load(cache) if os.path.exists(cache) else np.full((H, W), np.nan, np.float32)
todo = [i for i in range(H) if np.isnan(dem[i]).all()]
print(f"relevo: {H - len(todo)}/{H} linhas já baixadas; faltam {len(todo)}")


def row(i):
    lat = LAT1 - i * STEP * M2DEG
    g = json.dumps({"paths": [[[LON0, lat], [LON1, lat]]]})
    params = dict(geometry=g, geometryType="esriGeometryPolyline", sampleCount=W - 1,
                  returnFirstValueOnly="true", interpolation="RSP_BilinearInterpolation", f="json")
    for k in range(6):
        try:
            d = sess().get(f"{SVC}/Gale_DEM_SMG_1m/ImageServer/getSamples", params=params, timeout=90).json()
            s = d["samples"]
            v = np.array([float(x["value"]) if x["value"] not in ("NoData", "") else np.nan for x in s], np.float32)
            if len(v) != W:
                raise ValueError(f"linha {i}: {len(v)} amostras")
            return i, v
        except Exception as e:
            time.sleep(2 * (k + 1)); err = e
    raise err


t0 = time.time()
with ThreadPoolExecutor(12) as ex:
    for n, (i, v) in enumerate(ex.map(row, todo), 1):
        dem[i] = v
        if n % 100 == 0:
            np.save(cache, dem)
            print(f"  {n}/{len(todo)} linhas ({time.time() - t0:.0f} s)", flush=True)
np.save(cache, dem)
dem[(dem < -9000) | (dem > 30000)] = np.nan
print("  altitude", np.nanmin(dem), "a", np.nanmax(dem), "m; sem dado:", round(float(np.isnan(dem).mean() * 100), 2), "%")
np.save(f"{out}/dem2m.npy", dem)
# Georreferência no formato usado por route.py / export_3d.py (centro da célula (0,0) = LON0, LAT1)
json.dump({"r0": 0, "c0": 0, "step": STEP, "R": R,
           "ULX": R * math.radians(LON0) - STEP / 2, "ULY": R * math.radians(LAT1) + STEP / 2,
           "bounds": [[LAT0, LON0], [LAT1, LON1]]}, open(f"{out}/dem2m.json", "w"))

# 2. Textura: tiles WMTS equiretangulares do HiRISE (nível 15 ≈ 1,3 m/pixel)
print("imagem: montando tiles HiRISE do Mars Trek…")
Z = 15
span = 180 / 2 ** Z  # graus por tile
lon_l, lon_r = LON0 - STEP / 2 * M2DEG, LON1 + STEP / 2 * M2DEG
lat_t, lat_b = LAT1 + STEP / 2 * M2DEG, LAT0 - STEP / 2 * M2DEG
c0, c1 = int((lon_l + 180) // span), int((lon_r + 180) // span)
r0, r1 = int((90 - lat_t) // span), int((90 - lat_b) // span)
mos = Image.new("L", ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))


def tile(rc):
    r, c = rc
    for k in range(5):
        try:
            b = sess().get(f"{TILES}/{Z}/{r}/{c}.png", timeout=60)
            if b.status_code == 200:
                return r, c, Image.open(io.BytesIO(b.content)).convert("L")
        except Exception:
            pass
        time.sleep(1 + k)
    return r, c, None


with ThreadPoolExecutor(12) as ex:
    for r, c, im in ex.map(tile, [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]):
        if im is not None:
            mos.paste(im, ((c - c0) * 256, (r - r0) * 256))
px = 256 / span
box = ((lon_l + 180 - c0 * span) * px, (90 - lat_t - r0 * span) * px, (lon_r + 180 - c0 * span) * px, (90 - lat_b - r0 * span) * px)
tex = mos.crop(tuple(round(v) for v in box))
tex.save(f"{out}/texture_src.png")
print("  textura", tex.size)

# 3. Trajeto do Curiosity disponível no Mars Trek
print("trajeto: consultando curiosity_path…")
q = sess().get(f"{SVC}/curiosity_path/MapServer/0/query",
               params=dict(where="1=1", outFields="FID", returnGeometry="true", f="json"), timeout=120).json()
pts = [p for ft in q["features"] for path in ft["geometry"].get("paths", []) for p in path]
trav, last, dist = [], None, 0.0
for lon, lat in pts[::4]:
    i = round((LAT1 - lat) / (STEP * M2DEG)); j = round((lon - LON0) / (STEP * M2DEG))
    el = float(dem[i, j]) if 0 <= i < H and 0 <= j < W and np.isfinite(dem[i, j]) else None
    if last is not None:
        dist += math.hypot((lon - last[0]) * math.cos(math.radians(lat)), lat - last[1]) / M2DEG / 1000
    last = (lon, lat)
    trav.append([round(lat, 6), round(lon, 6), None if el is None else round(el), None, round(dist, 3)])
json.dump(trav, open(f"{out}/traverse.json", "w"), separators=(",", ":"))
print("  pontos", len(trav), "· fim em", trav[-1][:2])
