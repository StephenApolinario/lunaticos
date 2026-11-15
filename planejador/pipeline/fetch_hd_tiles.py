"""Baixa tiles HiRISE de resolução mais alta para a textura do 3D (~0,6 m/pixel).

Uso: python pipeline/fetch_hd_tiles.py data        (versão ampliada: HiRISE colorido do mapa oficial do Curiosity, zoom 17)
     python pipeline/fetch_hd_tiles.py data_hk     (versão hackathon: HiRISE do JPL Mars Trek, nível 16 equiretangular)
Salva em <data>/tiles_hd/{z}/{x}/{y}.png (ou {z}/{row}/{col}.png no Mars Trek). Retoma se interrompido.
"""
import io, json, math, os, sys, time, threading
from concurrent.futures import ThreadPoolExecutor
import requests

D = sys.argv[1]
g = json.load(open(f"{D}/dem2m.json"))
HK = "data_hk" in D.replace("\\", "/").split("/")[-1] or g.get("step", 2) >= 4
R, ULX, ULY, r0, c0, ST = g["R"], g["ULX"], g["ULY"], g["r0"], g["c0"], g["step"]
import numpy as np
H, W = np.load(f"{D}/dem2m.npy", mmap_mode="r").shape
lat_t = math.degrees((ULY - r0) / R); lat_b = math.degrees((ULY - (r0 + H * ST)) / R)
lon_l = math.degrees((c0 + ULX) / R); lon_r = math.degrees((c0 + W * ST + ULX) / R)
out = f"{D}/tiles_hd"
tl = threading.local()

if HK:
    Z = 16; span = 180 / 2 ** Z
    URL = "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/{z}/{a}/{b}.png"
    cols = range(int((lon_l + 180) // span), int((lon_r + 180) // span) + 1)
    rows = range(int((90 - lat_t) // span), int((90 - lat_b) // span) + 1)
    jobs = [(Z, r, c, URL.format(z=Z, a=r, b=c)) for r in rows for c in cols]  # salva como z/row/col
else:
    Z = 17; n = 2 ** Z
    fx = lambda lon: (lon + 180) / 360 * n
    fy = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/{z}/{x}/{y}.png"
    jobs = [(Z, x, y, URL.format(z=Z, x=x, y=n - 1 - y))  # servidor usa TMS (y invertido)
            for x in range(int(fx(lon_l)), int(fx(lon_r)) + 1) for y in range(int(fy(lat_t)), int(fy(lat_b)) + 1)]


def get(job):
    z, a, b, url = job
    p = f"{out}/{z}/{a}/{b}.png"
    if os.path.exists(p):
        return 1
    if not hasattr(tl, "s"):
        tl.s = requests.Session()
    for k in range(5):
        try:
            r = tl.s.get(url, timeout=60)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "wb").write(r.content)
                return 1
            if r.status_code == 404:
                return 0
        except Exception:
            pass
        time.sleep(1 + k)
    return 0


print("tiles:", len(jobs), "(hackathon / Mars Trek)" if HK else "(ampliada / MMGIS)")
t0 = time.time(); ok = 0
with ThreadPoolExecutor(12) as ex:
    for i, v in enumerate(ex.map(get, jobs), 1):
        ok += v
        if i % 200 == 0:
            print(f"  {i}/{len(jobs)} ({time.time() - t0:.0f} s)", flush=True)
print("ok", ok, "de", len(jobs))
json.dump({"z": Z, "kind": "eq" if HK else "merc"}, open(f"{out}/info.json", "w"))
