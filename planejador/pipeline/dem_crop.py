"""Recorta o DEM de 1 m do Gale (USGS) só na área da rota, sem baixar os 3,8 GB.
Uso: python pipeline/dem_crop.py data/tifftags.json data/dem2m.npy"""
import requests, json, math, sys, numpy as np, imagecodecs
from concurrent.futures import ThreadPoolExecutor
U="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
tags=json.load(open(sys.argv[1])); out=sys.argv[2]
offs=tags["273"][3]; cnts=tags["279"][3]
R=3396190.0; ULX=8127993.992786024; ULY=-244781.575189438; W=32980
LAT0,LAT1,LON0,LON1=-4.820,-4.720,137.370,137.418
STEP=2
col=lambda lon:R*math.radians(lon)-ULX
row=lambda lat:ULY-R*math.radians(lat)
r0,r1=int(row(LAT1)),int(row(LAT0)); c0,c1=int(col(LON0)),int(col(LON1))
rows=list(range(r0,r1,STEP)); print("rows",len(rows),"cols",(c1-c0)//STEP, "r",r0,r1,"c",c0,c1)
import threading, time
tl=threading.local()
def get(r):
    err=None
    if not hasattr(tl,"s"): tl.s=requests.Session()
    for k in range(8):
        try:
            resp=tl.s.get(U,headers={"Range":f"bytes={offs[r]}-{offs[r]+cnts[r]-1}"},timeout=60)
            b=resp.content
            if resp.status_code!=206 or len(b)!=cnts[r]: raise IOError(f"status {resp.status_code} len {len(b)}")
            return b
        except Exception as e:
            err=e; time.sleep(0.5*(k+1))
    raise err
with ThreadPoolExecutor(12) as ex: raw=list(ex.map(get,rows))
bad=0; data=[]
for b in raw:
    d=imagecodecs.lzw_decode(b)
    if len(d)!=W*4:
        bad+=1; d=(d+bytes(W*4))[:W*4]
    data.append(np.frombuffer(d,dtype='<f4')[c0:c1:STEP])
print("bad rows",bad)
dem=np.vstack(data); dem[dem<-30000]=np.nan
print("shape",dem.shape,"min",np.nanmin(dem),"max",np.nanmax(dem),"nan",np.isnan(dem).mean())
np.save(out,dem)
json.dump({"r0":r0,"c0":c0,"step":STEP,"R":R,"ULX":ULX,"ULY":ULY},open(out.replace('.npy','.json'),'w'))
