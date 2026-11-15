# EDL : le contrat entre le directeur et le rendu

`projects/<slug>/edl.json` décrit entièrement un Reel. Le directeur l'écrit, `validate` le vérifie, le rendu l'exécute. La source de vérité est `src/edl/schema.ts` (zod) ; ce document en explique le sens et change avec lui.

Exemple de référence, écrit à la main sur le footage synthétique (`scripts/synthetic/`) : `examples/demo/edl.json` (coupes de silences, de mots de remplissage, d'une répétition et d'une prise ratée ; échelles alternées ; zoom progressif ; emphase ; correction).

## Vue d'ensemble

```ts
type EDL = {
  version: 1
  meta: { title: string; fps: 30; width: 1080; height: 1920; brand: string; language: string }
  segments: Segment[]      // piste principale, jouée dans l'ordre (au moins un)
  transitions: Transition[]
  overlays: Overlay[]      // animations, titres, b-roll par-dessus
  captions: CaptionConfig
  audio: AudioConfig
  notes?: string           // intention du directeur, pour relecture humaine
}
```

Tous les objets sont stricts : une clé inconnue est une erreur de schéma (une faute de frappe ne passe pas en silence). `meta.brand` nomme un brand kit de `src/brand/index.ts` (`"default"`).

## Temps et ancres

Tous les temps sont en secondes. La durée de sortie n'est écrite nulle part : c'est la somme des durées des segments.

Un événement ne donne jamais un temps de sortie absolu. Il s'**ancre** :

```ts
type Anchor =
  | { word: string; edge?: "start" | "end"; offset?: number }   // "c1-w42" : au début du mot 42 du clip c1
  | { segment: string; offset?: number }                        // n secondes après le début du segment
```

Les identifiants de mots sont ceux de `analysis.json` (`words`) : l'identifiant du clip puis le rang du mot dans ce clip. `offset` est en secondes de sortie, positif ou négatif.

Raison : quand on resserre une coupe, tout ce qui suit se décale. Avec des ancres, les animations et les effets sonores restent collés au mot qui les déclenche. Ancrer sur un mot supprimé par les coupes est une erreur de validation.

## Segments

```ts
type Segment = ClipSegment | SceneSegment

type ClipSegment = {
  id: string; type: "clip"   // id : lettres, chiffres, "-" et "_"
  clip: string               // "c1"
  in: number; out: number    // secondes dans le clip normalisé
  framing: Framing
  speed?: number             // 1 par défaut, de 0,25 à 4 ; le segment dure (out - in) / speed
}

type SceneSegment = {
  id: string; type: "scene"
  duration: number
  background: { kind: "color" | "gradient" | "image" | "video"; value: string }   // CSS, ou un fichier
}

type Framing = {
  scale: number                       // 1 = recadrage 9:16 de base ; jamais moins de 1
  origin: { x: number; y: number }    // centre du cadrage, 0..1 dans l'image source
  move?: { toScale: number; toOrigin?: { x: number; y: number }; ease: Ease }   // zoom progressif sur la durée du segment
}

type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut"   // cubiques
```

Un changement de `scale` entre deux segments consécutifs est un « punch-in » : c'est ce qui masque un jump cut. Deux segments qui se suivent dans la source (`out` de l'un égal au `in` du suivant, même clip, vitesse 1) changent le cadrage sans couper : le son reste continu.

**Cadrage.** Le recadrage de base est le plus grand rectangle 9:16 contenu dans l'image source, quelle que soit sa résolution (toute l'image pour une source 1080×1920 ; une bande de 607×1080 pour une source 1920×1080). `scale` le réduit autour de `origin`. Le rectangle ne sort jamais de l'image source : s'il le devait, il est **décalé** (pas réduit) jusqu'au bord, et l'origine n'est alors plus au centre de l'image ; `validate` le signale (`framing-shifted`). Sur une source 9:16, un cadrage d'échelle s ne peut donc se centrer qu'entre 1/(2s) et 1 − 1/(2s) de la largeur et de la hauteur : à 1,2, entre 0,417 et 0,583. Pendant un `move`, l'échelle et l'origine sont interpolées image par image avec la courbe `ease`, de la première image du segment (valeurs de départ) à la dernière (valeurs d'arrivée).

**Scènes.** Phase 6. D'ici là le rendu affiche les fonds `color` et `gradient` (valeur CSS) ; `image` et `video` sont refusés par `validate`.

## Transitions

```ts
type Transition = {
  between: [string, string]      // ids de deux segments consécutifs
  type: "cut" | "fade" | "slide" | "whip" | "zoom" | "flash" | "glitch"
  duration: number               // 0 pour "cut"
  direction?: "left" | "right" | "up" | "down"
}
```

Sans entrée, la jonction est une coupe franche. Les transitions autres que `cut` sont rendues à partir de la phase 3 ; d'ici là `validate` les refuse (`not-rendered-yet`) plutôt que de les rendre en coupe franche sans le dire.

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

type Motion = { kind: "fade" | "slide" | "pop" | "scale"; duration: number; direction?: "left" | "right" | "up" | "down" }
```

`zone: "full"` remplace l'image (b-roll ou animation plein écran) pendant que la voix continue. Le catalogue de composants arrive en phase 3 (la forme de `Motion` y sera confirmée) ; avant, aucun composant n'est enregistré et `validate` refuse tout overlay (`unknown-overlay`).

## Sous-titres

```ts
type CaptionConfig = {
  enabled: boolean
  style: string                  // nom dans src/remotion/captions/styles.ts ("bold")
  maxWordsPerPage: number        // 2 à 4
  position: "center" | "lower-third" | "auto"
  emphasis: { word: string; style: "color" | "scale" | "box" }[]
  overrides: { word: string; text: string }[]   // corrections de transcription ; "" retire le mot des sous-titres
  hide: { from: Anchor; to: Anchor }[]           // masquer pendant un overlay plein écran chargé en texte
}
```

Les pages de sous-titres ne sont pas écrites dans l'EDL : `resolve` les dérive des mots conservés par les segments. Le directeur ne fournit que le style, l'emphase et les corrections.

- **Mots conservés.** Un mot est conservé par un segment si au moins la moitié de sa durée est jouée ; ses temps sont alors bornés au segment. Un mot joué deux fois (deux segments sur la même source) apparaît deux fois ; les ancres utilisent sa première occurrence.
- **Pages.** Dans l'ordre de sortie, au plus `maxWordsPerPage` mots ; nouvelle page après une ponctuation de fin de phrase ou de proposition (`. ! ? … , ; :`), après une pause d'au moins `pageBreakGapSeconds` (style), à l'entrée et à la sortie d'un `hide`, et quand le mot suivant ne tient plus dans la largeur sûre. Une page ne finit pas sur un article, un déterminant, une préposition, un pronom sujet ou un nombre quand ce mot peut passer sur la page suivante (« un petit micro » reste groupé, « 30 secondes » aussi). Le regroupement final est fait par `createTikTokStyleCaptions` de `@remotion/captions` à partir de ces coupures.
- **Lignes.** Une ligne de préférence, deux au plus, environ 18 caractères par ligne, mesurées avec la police réelle du brand kit (`src/edl/measure.ts`). Si un seul mot dépasse la largeur sûre, la page est composée plus petit (jusqu'à `minFontSize`) et `validate` le signale (`caption-shrunk`) ; s'il ne tient toujours pas, c'est une erreur (`caption-overflow`).
- **Temps.** Une page apparaît au début de son premier mot et reste jusqu'au début de la page suivante, au plus `lingerSeconds` après la fin de son dernier mot, jamais dans un `hide`. Le mot actif est surligné du début de ce mot au début du suivant (le dernier, jusqu'à la fin de la page).
- **Position.** `auto` vaut `lower-third`, sauf pendant un overlay de zone `bottom` ou `full`, où elle vaut `center`. La position verticale de chaque valeur est dans le style ; le bloc est centré horizontalement sur l'image.
- **Emphase.** `color` : couleur d'accent du brand kit ; `scale` : mot plus grand (`emphasisScale` du style) ; `box` : mot sur un fond d'accent.

## Audio

```ts
type AudioConfig = {
  voice: { targetLufs: -14; denoise: boolean }
  music?: { file: string; gainDb: number; duck: boolean; startAt?: number; fadeOut: number }
  sfx: { file: string; at: Anchor; gainDb: number }[]
}
```

La voix est le son des clips, normalisé par `reels render` à `targetLufs` (EBU R128 en deux passes, crête vraie −1 dBTP). La musique, les effets sonores et la réduction de bruit arrivent en phase 5 ; d'ici là `validate` refuse `music`, une liste `sfx` non vide et `denoise: true`.

## Résolution

`resolve(edl, faits)` (`src/edl/resolve.ts`) lit les mots dans `analysis.words` (bornes recalées sur l'énergie audio, plus justes que celles de `transcript.json`) et la taille des clips dans `probe.json`, et produit l'EDL résolu que consomme Remotion (`src/edl/resolved.ts`) : chaque segment, overlay, page et mot de sous-titre, effet sonore y porte des images de sortie (`fromFrame`, `durationInFrames`), avec le brand kit et le style de sous-titres complets. Les composants Remotion ne lisent que l'EDL résolu et ne refont aucun calcul de temps. C'est le seul endroit où les secondes deviennent des images.

- **Pas de dérive.** Les bornes des segments sont placées sur le temps de sortie cumulé exact : image = arrondi(secondes × 30). Chaque borne est à moins d'une demi-image de son temps exact, quel que soit le nombre de segments avant elle ; la durée totale est la somme exacte des segments arrondie une seule fois.
- **Source jouée.** Un segment `clip` commence sur l'image source arrondi(`in` × 30) (ou juste après le segment précédent s'il le continue dans la source) et en joue `durationInFrames × speed` images. C'est cet intervalle réellement joué, et non `in`/`out` tels qu'écrits, qui sert à décider des mots conservés et des mots coupés.
- **Ancres.** Mot : début (ou fin) de sa première occurrence en sortie, plus `offset`. Segment : première image du segment, plus `offset`.

## Règles de validation

`reels validate <slug>` : schéma zod, puis ces règles. Une erreur bloque `preview` et `render` ; un avertissement est affiché. Le nom entre crochets est celui que `validate` imprime.

Erreurs :

- Segments `clip` : `in < out` [`segment-in-out`], `out` dans les bornes du clip [`segment-out-of-clip`], clip existant [`unknown-clip`], au moins une image [`segment-too-short`] ; identifiants uniques [`duplicate-id`].
- Aucun bord de segment à l'intérieur d'un mot : un bord qui entre de plus de 0,02 s dans un mot le tronque [`cut-inside-word`] (couper dans le silence avant ou après).
- Toute ancre pointe vers un mot conservé [`anchor-cut-word`], un mot existant [`anchor-unknown-word`] ou un segment existant [`anchor-unknown-segment`], et tombe dans le Reel [`anchor-out-of-range`] ; un `hide` finit après son début [`hide-empty`].
- Emphase et corrections désignent des mots existants [`caption-unknown-word`].
- Deux overlays de même `zone` et de même `layer` ne se chevauchent pas [`overlay-overlap`] ; composant enregistré [`unknown-overlay`] ; props conformes à son schéma [`overlay-props`].
- Une transition relie deux segments existants [`transition-unknown-segment`] et réellement consécutifs [`transition-not-consecutive`], une seule par jonction [`transition-duplicate`], dure 0 pour `cut` et plus de 0 sinon [`transition-duration`], et moins que le plus court des deux segments [`transition-too-long`].
- Aucun texte hors de la zone sûre (voir `DIRECTOR.md`) : la boîte de chaque page, contour et grossissement du mot actif compris, reste dans les marges du brand kit [`caption-safe-zone`] ; aucun mot trop large même réduit [`caption-overflow`].
- Brand kit et style de sous-titres existants [`unknown-brand`, `unknown-caption-style`].
- Durée totale comprise entre 5 s et 90 s [`duration`].
- Ce que le rendu ne sait pas encore faire est refusé plutôt qu'ignoré [`not-rendered-yet`] : transitions autres que `cut` (phase 3), musique, effets sonores, réduction de bruit (phase 5), fonds de scène `image` et `video` (phase 6).

Avertissements :

- Cadrage décalé pour rester dans l'image source [`framing-shifted`] ; échelle au-delà du maximum conseillé, 1,4 sur une source 1080p, 1,8 en 4K [`framing-scale`].
- Page de sous-titres composée plus petit que le style [`caption-shrunk`].
- Emphase ou correction sur un mot coupé, donc sans effet [`caption-cut-word`] ; mot joué par deux segments [`word-kept-twice`].
