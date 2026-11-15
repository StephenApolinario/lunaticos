"""Exporta a cena 3D: relevo, textura HiRISE em alta resolução (em faixas) e mapa de inclinação para a iluminação.

Uso: python pipeline/export_3d.py data app/public          (versão ampliada)
     python pipeline/export_3d.py data_hk app/public/hk    (versão hackathon)

Requer <data>/tiles_hd/ (python pipeline/fetch_hd_tiles.py <data>).
Gera em <saída>/3d/:
  height.bin    altitude dos vértices (grade de ~4 m, Uint16 em decímetros acima do mínimo)
  tex_<k>.jpg   textura HiRISE de cada faixa (~0,7 m/pixel, até 4096 px por lado)
  grad.png      inclinação do terreno na resolução do DEM (R = dz/dx, G = dz/dy; 128 = plano, ±2 m/m)
  scene.json    grade, faixas e georreferência
"""
import json, math, os, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
data, web = sys.argv[1], sys.argv[2]
out = os.path.join(web, "3d"); os.makedirs(out, exist_ok=True)
for f in os.listdir(out):  # limpa faixas antigas
    if f.startswith("tex_") or f == "texture.jpg":
        os.remove(os.path.join(out, f))

dem = np.load(f"{data}/dem2m.npy")
g = json.load(open(f"{data}/dem2m.json"))
R, ULX, ULY, r0, c0, ST = g["R"], g["ULX"], g["ULY"], g["r0"], g["c0"], g["step"]
dem = np.where(np.isnan(dem), np.nanmin(dem), dem)

# 1. Vértices a ~4 m
F = 2 if ST < 3 else 1
H2, W2 = (dem.shape[0] // F) * F, (dem.shape[1] // F) * F
hm = dem[:H2, :W2].reshape(H2 // F, F, W2 // F, F).mean(axis=(1, 3))
rows, cols = hm.shape
cell = ST * F
hmin, hmax = float(hm.min()), float(hm.max())
((hm - hmin) * 10).round().astype("<u2").tofile(f"{out}/height.bin")

# Posição geográfica do centro de cada vértice
lat_v = lambda i: math.degrees((ULY - r0 - (i * F + F / 2) * ST) / R)
lon_v = lambda j: math.degrees((c0 + (j * F + F / 2) * ST + ULX) / R)

# 2. Mapa de inclinação na resolução total do DEM (detalhe fino na luz)
gy, gx = np.gradient(dem, ST)  # gy: ao longo das linhas (para o sul = +z na cena)
enc = lambda a: np.clip(np.round(a / 2 * 127.5 + 127.5), 0, 255).astype(np.uint8)
Image.fromarray(np.dstack([enc(gx), enc(gy), np.zeros(dem.shape, np.uint8)])).save(f"{out}/grad.png", optimize=True)

# 3. Textura HiRISE em faixas
tdir = f"{data}/tiles_hd"
info = json.load(open(f"{tdir}/info.json"))
Z, kind = info["z"], info["kind"]
if kind == "merc":
    n = 2 ** Z
    px = lambda lon: (lon + 180) / 360 * n * 256
    py = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n * 256
    tile_path = lambda tx, ty: f"{tdir}/{Z}/{tx}/{ty}.png"
else:
    span = 180 / 2 ** Z
    px = lambda lon: (lon + 180) / span * 256
    py = lambda lat: (90 - lat) / span * 256
    tile_path = lambda tx, ty: f"{tdir}/{Z}/{ty}/{tx}.png"
mode = "RGB" if kind == "merc" else "L"


def mosaic(lat_t, lat_b, lon_l, lon_r, w, h):
    x0, x1, y0, y1 = px(lon_l), px(lon_r), py(lat_t), py(lat_b)
    tx0, tx1, ty0, ty1 = int(x0 // 256), int(x1 // 256), int(y0 // 256), int(y1 // 256)
    m = Image.new(mode, ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            p = tile_path(tx, ty)
            if os.path.exists(p):
                m.paste(Image.open(p).convert(mode), ((tx - tx0) * 256, (ty - ty0) * 256))
    box = (x0 - tx0 * 256, y0 - ty0 * 256, x1 - tx0 * 256, y1 - ty0 * 256)
    return m.resize((w, h), Image.LANCZOS, box=box)


Wm, Hm = (cols - 1) * cell, (rows - 1) * cell
res = max(0.65, Wm / 4096)  # metros por pixel da textura
tw = min(4096, round(Wm / res))
B = math.ceil(Hm / res / 4096)
edges = [round(k * (rows - 1) / B) for k in range(B + 1)]
bands = []
for k in range(B):
    a, b = edges[k], edges[k + 1]
    th = min(4096, round((b - a) * cell / res))
    img = mosaic(lat_v(a), lat_v(b), lon_v(0), lon_v(cols - 1), tw, th)
    name = f"tex_{k}.jpg"
    img.save(f"{out}/{name}", quality=84, optimize=True, progressive=True)
    bands.append({"r0": a, "r1": b, "tex": name, "size": [tw, th]})
    print(f"faixa {k}: linhas {a}-{b}, textura {tw}x{th} ({os.path.getsize(f'{out}/{name}') // 1024} KB)")

json.dump({
    "grid": {"rows": rows, "cols": cols, "cell": cell, "hmin": hmin, "hmax": hmax,
             "bounds": [[lat_v(rows - 1), lon_v(0)], [lat_v(0), lon_v(cols - 1)]]},
    "grad": {"file": "grad.png", "rows": dem.shape[0], "cols": dem.shape[1], "step": ST,
             "offset": F * ST / 2, "scale": 2},
    "bands": bands,
    "texRes": round(res, 2),
}, open(f"{out}/scene.json", "w"))
print(f"grade {rows}x{cols} a {cell} m · textura {res:.2f} m/pixel em {B} faixas · grad.png {os.path.getsize(f'{out}/grad.png') // 1024} KB")
