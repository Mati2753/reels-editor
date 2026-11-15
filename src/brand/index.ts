/**
 * Brand kits: colours, fonts and safe-zone margins. Components never hard-code any of
 * these; they read the kit that the resolved EDL carries (`meta.brand` names it).
 *
 * Pure data: imported by the resolver (Node) and by the Remotion bundle.
 */

export interface FontSpec {
  /** CSS family name the font is registered under. */
  family: string;
  /** File in assets/fonts/. */
  file: string;
  weight: number;
}

export interface SafeZone {
  /** Pixels of the 1080x1920 frame covered by the platform's interface, per edge. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface BrandKit {
  name: string;
  colors: {
    /** Caption and title text. */
    text: string;
    /** Outline and shadow around text, for legibility on any background. */
    outline: string;
    /** Word being spoken. */
    active: string;
    /** Brand colour: emphasis, boxes. */
    accent: string;
    /** Text drawn on an accent box. */
    onAccent: string;
    /** Behind everything (visible only where nothing else is drawn). */
    background: string;
  };
  fonts: {
    /** Captions and titles: bold sans serif (docs/DIRECTOR.md, Sous-titres). */
    caption: FontSpec;
  };
  safeZone: SafeZone;
}

/**
 * Default kit. Montserrat ExtraBold (SIL Open Font License 1.1, assets/fonts/Montserrat-OFL.txt)
 * is shipped in the repository so rendering works offline. Safe zone from docs/DIRECTOR.md.
 */
export const defaultBrand: BrandKit = {
  name: "default",
  colors: {
    text: "#FFFFFF",
    outline: "#000000",
    active: "#FFD400",
    accent: "#00D1FF",
    onAccent: "#0B0B0F",
    background: "#000000",
  },
  fonts: {
    caption: { family: "Montserrat", file: "Montserrat-ExtraBold.ttf", weight: 800 },
  },
  safeZone: { top: 250, bottom: 420, left: 60, right: 130 },
};

export const brands: Readonly<Record<string, BrandKit>> = {
  default: defaultBrand,
};
