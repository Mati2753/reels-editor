import { describe,it,expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VisualAssetOptionsSchema, inspectVisualAssets } from "./visual-assets";
describe("visual asset permissions and measurement budgets",()=>{
 it("rejects remote media and out-of-budget frame requests",async()=>{await expect(inspectVisualAssets("https://example.com/movie.mp4")).rejects.toThrow();expect(VisualAssetOptionsSchema.safeParse({timestamps:[1,2,3],maxFrames:1}).success).toBe(false);});
 it("rejects an unowned file before launching any worker",async()=>{const dir=await mkdtemp(path.join(tmpdir(),"cutroom-vision-"));try{const file=path.join(dir,"clip.mp4");await writeFile(file,"test");await expect(inspectVisualAssets(file,{},path.join(dir,"missing"))).rejects.toThrow();}finally{await rm(dir,{recursive:true,force:true});}});
});

import { spawnSync } from "node:child_process";
import { ffmpeg } from "../pipeline/util/exec";

const haveOcr = spawnSync("tesseract", ["--list-langs"], { encoding: "utf8" }).stdout?.split(/\r?\n/).includes("eng");
it.skipIf(!haveOcr)("reads two actual burned-in captions and brackets the change using native frame PTS", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-ocr-real-"));
  try {
    const file = path.join(dir, "cards.mp4");
    const font = "fontfile=assets/fonts/Montserrat-ExtraBold.ttf:fontsize=40:fontcolor=white:x=(w-tw)/2:y=240";
    await ffmpeg(["-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x151515:s=640x360:r=10:d=3", "-vf",
      `drawtext=${font}:text='MORNING LIGHT':enable='lt(t,1.5)',drawtext=${font}:text='QUIET FOREST':enable='gte(t,1.5)'`,
      "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", file]);
    const report = await inspectVisualAssets(file, { timestamps: [.01,.53,1.12,1.51,2.05,2.65] }, dir);
    expect(report.samples.map(s=>Number(s.seconds.toFixed(2)))).toEqual([.1,.6,1.2,1.6,2.1,2.7]);
    expect(report.cues).toMatchObject([
      { text:"MORNING LIGHT",firstSeen:.1,lastSeen:1.2,nextSample:1.6,observations:3 },
      { text:"QUIET FOREST",firstSeen:1.6,lastSeen:2.7,previousSample:1.2,observations:3 },
    ]);
    expect(report.captionStyle).toMatchObject({status:"inferred",estimatedInk:"#FFFFFF",fontFamily:null,animation:null});
    expect(report.samples[0]?.lines[0]?.colors?.contrastRatio).toBeGreaterThan(10);
    await expect(inspectVisualAssets(file,{language:"zzz",maxFrames:1})).rejects.toThrow(/language data/);
    await expect(inspectVisualAssets(file,{timestamps:[10]})).rejects.toThrow(/inside the source/);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 25_000);

it.skipIf(!haveOcr)("decodes irregular source timing and returns no typography for clean blank frames",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"cutroom-ocr-vfr-"));
  try {
    const file=path.join(dir,"vfr.mp4");
    await ffmpeg(["-loglevel","error","-f","lavfi","-i","color=c=black:s=160x90:r=12:d=2.5","-vf",
      "select='lt(t,1)+eq(mod(n,3),0)'","-fps_mode","vfr","-c:v","libx264","-threads","1",file]);
    const result=await inspectVisualAssets(file,{timestamps:[.05,1.05,1.30]});
    expect(result.samples.map(s=>Math.round(1000*s.seconds))).toEqual([83,1250,1500]);
    expect(result.samples.flatMap(s=>s.lines)).toEqual([]);
    expect(result.captionStyle).toBeNull();
    expect(result.semantics.status).toBe("disabled");
  }finally{await rm(dir,{recursive:true,force:true});}
},15_000);
