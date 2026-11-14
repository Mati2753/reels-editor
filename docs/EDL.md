# EDL : le contrat entre le directeur et le rendu

`projects/<slug>/edl.json` décrit entièrement un Reel. Le directeur l'écrit, `validate` le vérifie, le rendu l'exécute. La source de vérité est `src/edl/schema.ts` ; ce document en explique le sens.

## Vue d'ensemble

```ts
type EDL = {
  version: 1
  meta: { title: string; fps: 30; width: 1080; height: 1920; brand: string; language: string }
  segments: Segment[]      // piste principale, jouée dans l'ordre
  transitions: Transition[]
  overlays: Overlay[]      // animations, titres, b-roll par-dessus
  captions: CaptionConfig
  audio: AudioConfig
  notes?: string           // intention du directeur, pour relecture humaine
}
```

## Temps et ancres

Tous les temps sont en secondes. La durée de sortie n'est écrite nulle part : c'est la somme des segments.

Un événement ne donne jamais un temps de sortie absolu. Il s'**ancre** :

```ts
type Anchor =
  | { word: string; edge?: "start" | "end"; offset?: number }   // "w142" : au début du mot
  | { segment: string; offset?: number }                        // n secondes après le début du segment
```

Raison : quand on resserre une coupe, tout ce qui suit se décale. Avec des ancres, les animations et les effets sonores restent collés au mot qui les déclenche. Ancrer sur un mot supprimé par les coupes est une erreur de validation.

## Segments

```ts
type Segment = ClipSegment | SceneSegment

type ClipSegment = {
  id: string; type: "clip"
  clip: string             // "c1"
  in: number; out: number  // secondes dans le clip source
  framing: Framing
  speed?: number           // 1 par défaut
}

type SceneSegment = {
  id: string; type: "scene"
  duration: number
  background: { kind: "color" | "gradient" | "image" | "video"; value: string }
}

type Framing = {
  scale: number                  // 1 = recadrage 9:16 de base
  origin: { x: number; y: number }   // centre du cadrage, 0..1 dans l'image source
  move?: { toScale: number; toOrigin?: { x: number; y: number }; ease: Ease }  // zoom progressif sur la durée du segment
}
```

Un changement de `scale` entre deux segments consécutifs est un « punch-in » : c'est ce qui masque un jump cut.

## Transitions

```ts
type Transition = {
  between: [string, string]      // ids de deux segments consécutifs
  type: "cut" | "fade" | "slide" | "whip" | "zoom" | "flash" | "glitch"
  duration: number               // 0 pour "cut"
  direction?: "left" | "right" | "up" | "down"
}
```

Sans entrée, la jonction est une coupe franche.

## Overlays

```ts
type Overlay = {
  id: string
  component: string        // nom dans src/remotion/overlays/index.ts
  props: Record<string, unknown>   // validées par le schéma du composant
  at: Anchor
  duration: number
  layer: "background" | "behind-captions" | "front"
  zone: "top" | "center" | "bottom" | "full"
  enter?: Motion; exit?: Motion
}
```

`zone: "full"` remplace l'image (b-roll ou animation plein écran) pendant que la voix continue.

## Sous-titres

```ts
type CaptionConfig = {
  enabled: boolean
  style: string                  // nom dans src/remotion/captions/
  maxWordsPerPage: number        // 2 à 4
  position: "center" | "lower-third" | "auto"
  emphasis: { word: string; style: "color" | "scale" | "box" }[]
  overrides: { word: string; text: string }[]   // corrections de transcription
  hide: { from: Anchor; to: Anchor }[]           // masquer pendant un overlay plein écran chargé en texte
}
```

Les pages de sous-titres ne sont pas écrites dans l'EDL : elles sont dérivées des mots conservés par les segments. Le directeur ne fournit que le style, l'emphase et les corrections.

## Audio

```ts
type AudioConfig = {
  voice: { targetLufs: -14; denoise: boolean }
  music?: { file: string; gainDb: number; duck: boolean; startAt?: number; fadeOut: number }
  sfx: { file: string; at: Anchor; gainDb: number }[]
}
```

## Résolution

`resolve(edl, analysis)` lit les mots dans `analysis.words` (bornes recalées sur l'énergie audio, plus justes que celles de `transcript.json`) et produit l'EDL résolu que consomme Remotion : chaque segment, overlay, page de sous-titres et effet sonore y porte `fromFrame` et `durationInFrames`. Les composants Remotion ne lisent que l'EDL résolu et ne refont aucun calcul de temps.

## Règles de validation

- Segments `clip` : `in < out`, dans les bornes du clip.
- Toute ancre pointe vers un mot conservé ou un segment existant.
- Deux overlays de même `zone` et de même `layer` ne se chevauchent pas.
- Une transition relie deux segments réellement consécutifs et dure moins que le plus court des deux.
- Aucun texte hors de la zone sûre (voir `DIRECTOR.md`).
- Durée totale comprise entre 5 s et 90 s.
