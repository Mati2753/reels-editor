import { loadFont } from "@remotion/fonts";
import { useEffect, useState } from "react";
import { useDelayRender } from "remotion";
import type { BrandKit } from "../brand";
import montserratExtraBold from "../../assets/fonts/Montserrat-ExtraBold.ttf";

/**
 * Font files shipped in assets/fonts/, bundled with the composition so rendering works
 * offline. A brand kit names its fonts by file; add new files here.
 */
const FONT_URLS: Readonly<Record<string, string>> = {
  "Montserrat-ExtraBold.ttf": montserratExtraBold,
};

/** Loads the brand's fonts and holds the render until they are ready. */
export function useBrandFonts(brand: BrandKit): void {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender(`Loading fonts of brand "${brand.name}"`));
  useEffect(() => {
    const specs = Object.values(brand.fonts);
    Promise.all(
      specs.map((f) => {
        const url = FONT_URLS[f.file];
        if (!url) throw new Error(`Font file "${f.file}" is not registered in src/remotion/fonts.ts`);
        return loadFont({ family: f.family, url, weight: String(f.weight) });
      }),
    )
      .then(() => continueRender(handle))
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
  }, [brand, handle, continueRender, cancelRender]);
}
