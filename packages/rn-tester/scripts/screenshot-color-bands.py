#!/usr/bin/env python3
"""Report x-position bands of a colour in a device screenshot.

Verifying painting from screenshots is far cheaper than reading them as
images, and it produces numbers you can compare against computed geometry.

    python3 screenshot-color-bands.py shot.png <y0> <y1> <x0> <x1> 00aa77

CALIBRATE BEFORE TRUSTING A NEGATIVE. "no match" is indistinguishable from
"the scan was broken", and that cost a day here: `sips` emits BMPs that are
sometimes bottom-up (positive height) and sometimes top-down (negative), and
an earlier version of this script assumed bottom-up, silently scanning zero
pixels and reporting "no match" for pixels that were plainly on screen. Point
it at a colour you know is visible first, and only then trust a negative.
"""
import sys, subprocess, struct
png, y0, y1, x0, x1, hexc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
tr, tg, tb = int(hexc[0:2],16), int(hexc[2:4],16), int(hexc[4:6],16)
subprocess.run(["sips","-s","format","bmp",png,"--out","/tmp/_m.bmp"],capture_output=True)
d=open("/tmp/_m.bmp","rb").read()
off=struct.unpack_from("<I",d,10)[0]; w=struct.unpack_from("<i",d,18)[0]
rawh=struct.unpack_from("<i",d,22)[0]; bpp=struct.unpack_from("<H",d,28)[0]
topdown = rawh < 0
h = abs(rawh)
row=((w*bpp//8)+3)//4*4; byp=bpp//8
cols=set()
for y in range(max(0,y0),min(h,y1)):
    base=off+(y if topdown else h-1-y)*row
    for x in range(max(0,x0),min(w,x1)):
        i=base+x*byp; b,g,r=d[i],d[i+1],d[i+2]
        if abs(r-tr)<28 and abs(g-tg)<28 and abs(b-tb)<28: cols.add(x)
if not cols: print("no match"); sys.exit()
cs=sorted(cols); bands=[]; s=p=cs[0]
for x in cs[1:]:
    if x>p+2: bands.append((s,p)); s=x
    p=x
bands.append((s,p))
print(f"{hexc}: "+", ".join(f"{a}..{b}" for a,b in bands))
