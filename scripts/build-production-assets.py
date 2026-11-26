"""Rebuild the original warm look, paper grain, glint and octahedron from their editable sources."""
from pathlib import Path
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
out = root / "assets/production"
out.mkdir(exist_ok=True)

lut = ['TITLE "Amber print"', 'LUT_3D_SIZE 9']
for b in np.linspace(0, 1, 9):
    for g in np.linspace(0, 1, 9):
        for r in np.linspace(0, 1, 9):
            rgb = np.array([r, g, b])
            luma = np.dot(rgb, [0.2126, 0.7152, 0.0722])
            mapped = 0.93 * rgb + 0.07 * luma + 4 * luma * (1 - luma) * np.array([0.065, 0.011, -0.065])
            lut.append(" ".join(f"{v:.6f}" for v in np.clip(mapped, 0, 1)))
(out / "amber.cube").write_text("\n".join(lut) + "\n")

rng = np.random.default_rng(4261)
grain = rng.normal(0, 1, (256, 256))
pixels = np.zeros((256, 256, 4), np.uint8)
pixels[:, :, :3] = np.where(grain > 0, 245, 10)[:, :, None]
pixels[:, :, 3] = np.clip(np.abs(grain) * 24, 0, 55).astype(np.uint8)
Image.fromarray(pixels).save(out / 'paper.png')

vertices = np.array([[0,1.1,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1],[0,-1.1,0]])
faces = [(pole, i, i % 4 + 1) for pole in [0,5] for i in range(1,5)]
(out/'crystal.obj').write_text("o StudioCrystal\n" + "".join("v %g %g %g\n" % tuple(v) for v in vertices) +
                              "".join("f %d %d %d\n" % tuple(i+1 for i in f) for f in faces))

def animation(name, frames):
    cmd = ['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','192x192','-r','30',
           '-i','pipe:0','-an','-c:v','qtrle','-pix_fmt','argb',str(out/f'{name}.mov')]
    with subprocess.Popen(cmd, stdin=subprocess.PIPE) as pipe:
        for rgba in frames:
            pipe.stdin.write(rgba.tobytes())
        pipe.stdin.close()
        if pipe.wait(): raise RuntimeError('Could not encode '+name)

def crystal_frames():
    for i in range(90):
        t = 2*math.pi*i/90
        c,s=math.cos(t),math.sin(t)
        pts=vertices @ np.array([[c,0,s],[0,1,0],[-s,0,c]])
        pts=pts @ np.array([[1,0,0],[0,.96,.28],[0,-.28,.96]])
        screen=(pts[:,:2]*[131,-131]+192).astype(int)
        img=Image.new('RGBA',(384,384)); draw=ImageDraw.Draw(img)
        for f in sorted(faces,key=lambda f: pts[list(f),2].mean()):
            a,b,c=pts[list(f)]
            n=np.cross(b-a,c-a);n/=np.linalg.norm(n)
            if np.dot(n,(a+b+c)/3)<0:n=-n
            light=max(0,np.dot(n,[-.45,.65,.61]))
            color=tuple(int(v) for v in np.array([36,62,80])+light*np.array([101,156,158]))
            draw.polygon([tuple(screen[j]) for j in f],fill=color+(255,))
        yield img.resize((192,192),Image.Resampling.LANCZOS)

def glint_frames():
    y,x=np.mgrid[-1:1:192j,-1:1:192j]
    for i in range(45):
        strength=math.sin(math.pi*i/44)**2
        arms=np.exp(-np.abs(x)*85-np.abs(y)*5)+np.exp(-np.abs(y)*85-np.abs(x)*5)
        glow=np.exp(-(x*x+y*y)*260)
        rgba=np.empty((192,192,4),np.uint8); rgba[:,:,:3]=[255,229,166]
        rgba[:,:,3]=(255*strength*np.minimum(1,glow+.72*arms)).astype(np.uint8)
        yield Image.fromarray(rgba)

animation('crystal',crystal_frames())
animation('glint',glint_frames())
