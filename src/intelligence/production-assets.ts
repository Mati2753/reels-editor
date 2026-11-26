export const productionFiles = {
  "lut-amber": "amber.cube",
  "texture-paper": "paper.png",
  "object-crystal": "crystal.mov",
  "overlay-glint": "glint.mov",
} as const;
export type ProductionAssetId = keyof typeof productionFiles;
