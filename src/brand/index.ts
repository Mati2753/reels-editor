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
    /** Dark panels and full-screen backdrops of the overlays (text on it: `text`). */
    panel: string;
    /** Second colour of the full-screen backdrop gradient. */
    panelAlt: string;
    /** Light cards (quotes, messages, call to action). */
    surface: string;
    /** Text on `surface`. */
    onSurface: string;
    /** Secondary text on `panel` (labels, units). */
    muted: string;
    /** Secondary text on `surface`. */
    mutedOnSurface: string;
    /** Flash transition. */
    flash: string;
  };
  fonts: {
    /** Captions: bold sans serif (docs/DIRECTOR.md, Sous-titres). */
    caption: FontSpec;
    /** Overlay titles, keywords and numbers: the heaviest weight. */
    display: FontSpec;
    /** Overlay secondary text: labels, list items, messages. */
    body: FontSpec;
  };
  /** Shape of the overlay cards. */
  shape: {
    /** Corner radius of cards, px. */
    radius: number;
    /** CSS box-shadow of cards. */
    shadow: string;
    /** Opacity of dark panels drawn over the picture (0..1). */
    panelOpacity: number;
  };
  safeZone: SafeZone;
}

/**
 * Default kit. Montserrat ExtraBold, Black and SemiBold (SIL Open Font License 1.1, assets/fonts/Montserrat-OFL.txt)
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
    panel: "#0D1017",
    panelAlt: "#18202E",
    surface: "#FFFFFF",
    onSurface: "#0D1017",
    muted: "#A3ADBF",
    mutedOnSurface: "#5C6578",
    flash: "#FFFFFF",
  },
  fonts: {
    caption: { family: "Montserrat", file: "Montserrat-ExtraBold.ttf", weight: 800 },
    display: { family: "Montserrat", file: "Montserrat-Black.ttf", weight: 900 },
    body: { family: "Montserrat", file: "Montserrat-SemiBold.ttf", weight: 600 },
  },
  shape: { radius: 34, shadow: "0 24px 60px rgba(0, 0, 0, 0.38), 0 6px 16px rgba(0, 0, 0, 0.22)", panelOpacity: 0.9 },
  safeZone: { top: 250, bottom: 420, left: 60, right: 130 },
};

export const brands: Readonly<Record<string, BrandKit>> = {
  default: defaultBrand,
};
