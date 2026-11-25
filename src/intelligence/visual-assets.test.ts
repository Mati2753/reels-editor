import { describe,it,expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VisualAssetOptionsSchema, inspectVisualAssets } from "./visual-assets";
describe("visual asset permissions and measurement budgets",()=>{
 it("rejects remote media and out-of-budget frame requests",async()=>{await expect(inspectVisualAssets("https://example.com/movie.mp4")).rejects.toThrow();expect(VisualAssetOptionsSchema.safeParse({timestamps:[1,2,3],maxFrames:1}).success).toBe(false);});
 it("rejects an unowned file before launching any worker",async()=>{const dir=await mkdtemp(path.join(tmpdir(),"cutroom-vision-"));try{const file=path.join(dir,"clip.mp4");await writeFile(file,"test");await expect(inspectVisualAssets(file,{},path.join(dir,"missing"))).rejects.toThrow();}finally{await rm(dir,{recursive:true,force:true});}});
});
