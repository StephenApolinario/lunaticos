"""Lê a estrutura (offsets das linhas) do GeoTIFF do DEM do Gale.
Uso: python pipeline/tiffinfo.py data/tifftags.json"""
import requests, struct, sys
U="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
off=3867795758
tail=requests.get(U,headers={"Range":f"bytes={off}-"},timeout=120).content
n=struct.unpack('<H',tail[:2])[0]
TY={1:1,2:1,3:2,4:4,5:8,11:4,12:8,16:8}
FMT={1:'B',2:'c',3:'H',4:'I',5:'II',11:'f',12:'d',16:'Q'}
tags={}
for i in range(n):
    t,ty,c,v=struct.unpack('<HHII',tail[2+12*i:14+12*i])
    sz=TY[ty]*c
    if sz<=4: raw=tail[6+12*i:6+12*i+sz]
    else:
        rel=v-off
        raw=tail[rel:rel+sz] if 0<=rel<len(tail) else None
    vals=None
    if raw is not None and ty in (3,4,11,12,16):
        vals=struct.unpack('<'+FMT[ty]*c,raw)
    tags[t]=(ty,c,v,vals)
    print(t,ty,c,v, (vals[:6] if vals else raw[:60] if raw else 'outside'))
import json
json.dump({str(k):[a,b,c,(list(d) if d and len(d)>20 else d)] for k,(a,b,c,d) in tags.items()},open(sys.argv[1],'w'))
