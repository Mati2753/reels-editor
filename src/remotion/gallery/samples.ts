import type { Edl, Zone } from "../../edl/schema";
import type { TransitionType } from "../../edl/schema";

/**
 * Example props of every overlay and transition, for the gallery of the Studio and the
 * contact sheets of scripts/gallery.ts. Each overlay has a short text and a text at the
 * limit of what its schema accepts, to check that long text adapts instead of overflowing.
 */

export interface OverlaySample {
  component: string;
  /** Seconds on screen. */
  duration: number;
  short: Record<string, unknown>;
  long: Record<string, unknown>;
  /** Text at the limit for a zone smaller than the others (replaces `long` there). */
  longIn?: Partial<Record<Zone, Record<string, unknown>>>;
  /** Cue times, seconds after the overlay starts (list items, steps...). */
  cues?: number[];
}

export const overlaySamples: OverlaySample[] = [
  {
    component: "HookTitle",
    duration: 2.4,
    short: { text: "3 astuces pour filmer", highlight: ["astuces"], kicker: "Tuto" },
    long: { text: "Les trois erreurs qui ruinent toutes vos vidéos au téléphone", highlight: ["erreurs", "téléphone"], kicker: "À éviter absolument" },
  },
  {
    component: "KeywordPop",
    duration: 1.6,
    short: { text: "Lumière" },
    long: { text: "Balance des blancs manuelle", tone: "active", tilt: 4 },
  },
  {
    component: "BigNumber",
    duration: 2.2,
    short: { value: 87, suffix: "%", label: "des Reels regardés sans le son" },
    long: { value: 1250000, prefix: "+", suffix: "€", label: "de chiffre d'affaires réalisé en un an", countFrom: 0 },
  },
  {
    component: "ListReveal",
    duration: 3.2,
    short: { title: "3 astuces", items: ["Lumière", "Son", "Cadrage"] },
    long: {
      title: "Les cinq erreurs fréquentes",
      items: [
        "Filmer à contre-jour devant une fenêtre",
        "Utiliser le micro intégré du téléphone",
        "Cadrer beaucoup trop loin du visage",
        "Oublier de nettoyer l'objectif avant",
        "Tourner sans aucune stabilisation",
      ],
      numbered: true,
    },
    longIn: {
      top: {
        title: "Les trois erreurs fréquentes",
        items: ["Filmer à contre-jour devant une fenêtre", "Utiliser le micro intégré du téléphone", "Cadrer beaucoup trop loin du visage"],
        numbered: true,
      },
    },
    cues: [0.25, 0.8, 1.35, 1.9, 2.45],
  },
  {
    component: "CtaCard",
    duration: 2.6,
    short: { title: "Abonne-toi", subtitle: "Une astuce par jour", action: "follow", handle: "@reels.editor" },
    long: { title: "Enregistre-le pour plus tard", subtitle: "À revoir avant ton prochain tournage vidéo", action: "save", handle: "@un.compte.au.nom.long" },
  },
  {
    component: "SectionTitle",
    duration: 2,
    short: { index: "02", title: "Le son", subtitle: "Ce qui compte" },
    long: { index: "03", title: "Le cadrage et la composition", subtitle: "Les règles qui changent tout pour vos vidéos" },
  },
  {
    component: "LabelTag",
    duration: 2.2,
    short: { name: "Micro-cravate", detail: "Sans fil, 30 €", icon: "tool" },
    long: { name: "Studio Lumière Paris Onze", detail: "Location de matériel et de plateaux", icon: "pin" },
  },
  {
    component: "SplitCompare",
    duration: 3,
    short: { left: { label: "Avant", text: "Micro intégré" }, right: { label: "Après", text: "Micro-cravate" } },
    long: { left: { label: "Sans lumière", text: "Visage sombre et image pleine de bruit" }, right: { label: "Face fenêtre", text: "Peau nette et couleurs naturelles" }, winner: "right" },
    cues: [0.1, 0.9],
  },
  {
    component: "StepFlow",
    duration: 3.2,
    short: { title: "La méthode", steps: ["Cadrer", "Éclairer", "Tourner"] },
    long: { title: "Préparer un tournage", steps: ["Nettoyer l'objectif du téléphone", "Se placer face à une fenêtre", "Brancher le micro-cravate", "Filmer trois prises par phrase"] },
    cues: [0.15, 0.75, 1.35, 1.95],
  },
  {
    component: "QuoteCard",
    duration: 3,
    short: { quote: "Le son compte plus que l'image.", author: "Marie Dupont", detail: "Réalisatrice" },
    long: { quote: "Un spectateur pardonne une image moyenne, mais il part dès que le son est mauvais.", author: "Jean-Baptiste Martin", detail: "Ingénieur du son depuis vingt ans" },
  },
  {
    component: "ChatBubble",
    duration: 3,
    short: {
      name: "@abonné",
      messages: [
        { text: "Tu filmes avec quoi ?", from: "them" },
        { text: "Mon téléphone !", from: "me" },
      ],
    },
    long: {
      name: "@une.abonnée.curieuse",
      messages: [
        { text: "Quel micro utilises-tu pour un son aussi propre dehors ?", from: "them" },
        { text: "Un micro-cravate sans fil à trente euros, tout simplement.", from: "me" },
        { text: "Merci, je commande ça tout de suite pour mes vidéos !", from: "them" },
      ],
    },
    longIn: {
      top: {
        name: "@une.abonnée.curieuse",
        messages: [
          { text: "Quel micro utilises-tu pour un son aussi propre dehors ?", from: "them" },
          { text: "Un micro-cravate sans fil à trente euros, tout simplement.", from: "me" },
        ],
      },
    },
    cues: [0.1, 0.9, 1.7],
  },
  {
    component: "ChartGrow",
    duration: 3,
    short: {
      title: "Vues par mois",
      bars: [
        { label: "Jan", value: 12 },
        { label: "Fév", value: 19 },
        { label: "Mars", value: 34 },
      ],
      unit: "k",
    },
    long: {
      title: "Audience des six derniers mois",
      bars: [
        { label: "Janvier", value: 1200 },
        { label: "Février", value: 1850 },
        { label: "Mars", value: 2400 },
        { label: "Avril", value: 3900 },
        { label: "Mai", value: 5100 },
        { label: "Juin", value: 8800 },
      ],
      unit: "€",
      highlight: 5,
    },
    longIn: {
      center: {
        title: "Audience sur quatre mois",
        bars: [
          { label: "Mars", value: 2400 },
          { label: "Avril", value: 3900 },
          { label: "Mai", value: 5100 },
          { label: "Juin", value: 8800 },
        ],
        unit: "€",
      },
    },
  },
  {
    component: "LogoCard",
    duration: 2.2,
    short: { name: "CapCut", tagline: "Montage gratuit" },
    long: { name: "Studio Lumière Paris", initials: "SLP", tagline: "Location de matériel vidéo à Paris", shape: "circle" },
  },
  {
    component: "ScreenMock",
    duration: 3,
    short: { device: "phone", url: "monsite.fr", title: "Filmer mieux en 3 étapes", lines: ["Le guide gratuit"], button: "Télécharger" },
    long: {
      device: "browser",
      url: "boutique.monsite-video.fr",
      title: "Le kit complet pour filmer au téléphone",
      lines: ["Micro-cravate, lumière LED et trépied", "Livraison offerte dès cinquante euros", "Garantie deux ans sur tout le matériel"],
      button: "Voir le kit",
    },
  },
];

export type Background = "dark" | "light";

/** Two backgrounds standing for a dark and a bright shot (gradients with soft light blobs). */
export const BACKGROUNDS: Record<Background, string> = {
  dark: [
    "radial-gradient(ellipse 45% 30% at 30% 35%, rgba(255, 196, 140, 0.35), transparent 70%)",
    "radial-gradient(ellipse 50% 35% at 75% 70%, rgba(90, 140, 220, 0.35), transparent 70%)",
    "linear-gradient(180deg, #1d2430 0%, #2b2a2f 55%, #151517 100%)",
  ].join(", "),
  light: [
    "radial-gradient(ellipse 45% 30% at 30% 35%, rgba(255, 255, 255, 0.9), transparent 70%)",
    "radial-gradient(ellipse 50% 35% at 70% 75%, rgba(255, 214, 170, 0.7), transparent 70%)",
    "linear-gradient(180deg, #f1ece4 0%, #d9d2c7 55%, #c9c0b2 100%)",
  ].join(", "),
};

/** Offset of the overlay in its sample, seconds. */
export const SAMPLE_LEAD = 0.25;

const base = (title: string, segments: Edl["segments"]): Edl => ({
  version: 1,
  meta: { title, fps: 30, width: 1080, height: 1920, brand: "default", language: "fr" },
  segments,
  transitions: [],
  overlays: [],
  captions: { enabled: false, style: "bold", maxWordsPerPage: 3, position: "auto", emphasis: [], overrides: [], hide: [] },
  audio: { voice: { targetLufs: -14, denoise: false }, sfx: [] },
});

/** An EDL showing one overlay on a background: a scene, the overlay 0.25 s in. */
export function overlaySampleEdl(sample: OverlaySample, zone: Zone, variant: "short" | "long", background: Background): Edl {
  const edl = base(`${sample.component} ${zone} ${variant}`, [
    { id: "bg", type: "scene", duration: Math.max(5, sample.duration + 2 * SAMPLE_LEAD), background: { kind: "gradient", value: BACKGROUNDS[background] } },
  ]);
  const props = variant === "short" ? sample.short : (sample.longIn?.[zone] ?? sample.long);
  const items = Array.isArray(props.items)
    ? props.items.length
    : Array.isArray(props.steps)
      ? props.steps.length
      : Array.isArray(props.messages)
        ? props.messages.length
        : Array.isArray(props.bars)
          ? props.bars.length
          : undefined;
  const cues = sample.cues?.slice(0, items);
  edl.overlays.push({
    id: "sample",
    component: sample.component,
    props,
    at: { segment: "bg", offset: SAMPLE_LEAD },
    duration: sample.duration,
    layer: "front",
    zone,
    ...(cues ? { cues: cues.map((c) => ({ segment: "bg", offset: SAMPLE_LEAD + c })) } : {}),
  });
  return edl;
}

export const transitionSamples: { type: Exclude<TransitionType, "cut">; duration: number; direction?: "left" | "right" | "up" | "down" }[] = [
  { type: "fade", duration: 0.4 },
  { type: "slide", duration: 0.27, direction: "left" },
  { type: "whip", duration: 0.27, direction: "left" },
  { type: "zoom", duration: 0.23 },
  { type: "flash", duration: 0.13 },
  { type: "glitch", duration: 0.2 },
];

/** Two scenes of contrasting pictures joined by a transition. */
export function transitionSampleEdl(t: (typeof transitionSamples)[number]): Edl {
  const a = "repeating-linear-gradient(45deg, #23395b 0 60px, #2e4a75 60px 120px), #23395b";
  const b = "radial-gradient(circle at 50% 45%, #ffd27a 0 18%, transparent 19%), repeating-linear-gradient(0deg, #7a2948 0 80px, #93345a 80px 160px)";
  const edl = base(`transition ${t.type}`, [
    { id: "a", type: "scene", duration: 2.5, background: { kind: "gradient", value: a } },
    { id: "b", type: "scene", duration: 2.5, background: { kind: "gradient", value: b } },
  ]);
  edl.transitions.push({ between: ["a", "b"], type: t.type, duration: t.duration, ...(t.direction ? { direction: t.direction } : {}) });
  return edl;
}

/** The settled frame of an overlay sample: entrance done (and its cues shown), exit not started. */
export function settledFrame(edl: Edl): number {
  const ov = edl.overlays[0];
  if (!ov) return 0;
  const lastCue = ov.cues?.length ? Math.max(...ov.cues.map((c) => ("offset" in c ? (c.offset ?? 0) : 0))) - SAMPLE_LEAD : 0;
  const t = Math.max(lastCue + 0.5, Math.min(ov.duration * 0.6, 1.2));
  return Math.round((SAMPLE_LEAD + Math.min(t, ov.duration - 0.3)) * 30);
}

/** A cell of a contact sheet: a sample EDL shown at one frame. */
export interface SheetCell {
  edl: Edl;
  frame: number;
  label: string;
}
