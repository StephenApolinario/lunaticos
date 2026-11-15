import math, requests, os, json, sys
from concurrent.futures import ThreadPoolExecutor
out = sys.argv[1]  # app/public (tiles/)
data = sys.argv[2] if len(sys.argv) > 2 else out  # pasta data (traverse.json)
LAT0, LAT1, LON0, LON1 = -4.820, -4.720, 137.370, 137.418
def xyz(lat, lon, z):
    n = 2**z; lr = math.radians(lat)
    return int((lon+180)/360*n), int((1 - math.log(math.tan(lr)+1/math.cos(lr))/math.pi)/2*n)
base = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/{}/{}/{}.png"
jobs = []
for z in (14, 15, 16):
    x0, y0 = xyz(LAT1, LON0, z); x1, y1 = xyz(LAT0, LON1, z)
    for x in range(x0, x1+1):
        for y in range(y0, y1+1):
            jobs.append((z, x, y))
print("tiles", len(jobs))
def get(j):
    z, x, y = j
    r = requests.get(base.format(z, x, 2**z-1-y), timeout=60)
    if r.status_code == 200 and r.headers.get("content-type") == "image/png":
        p = os.path.join(out, "tiles", str(z), str(x)); os.makedirs(p, exist_ok=True)
        open(os.path.join(p, f"{y}.png"), "wb").write(r.content); return 1
    return 0
with ThreadPoolExecutor(8) as ex: ok = sum(ex.map(get, jobs))
print("ok", ok)
w = requests.get("https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json", timeout=60).json()
pts = [[round(f["properties"]["lat"],6), round(f["properties"]["lon"],6), round(f["properties"]["elev_geoid"]), f["properties"]["sol"], f["properties"]["dist_km"]] for f in w["features"] if 2300 <= f["properties"]["sol"] <= 4900]
json.dump(pts, open(os.path.join(data, "traverse.json"), "w"), separators=(",", ":"))
print("pts", len(pts))
