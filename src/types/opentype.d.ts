// Minimal typing of the part of opentype.js (MIT) used by src/edl/measure.ts. The package
// is CommonJS without an exports map: Node's ESM loader only offers its default export.
declare module "opentype.js" {
  export interface Font {
    unitsPerEm: number;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean; features?: Record<string, boolean> }): number;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
