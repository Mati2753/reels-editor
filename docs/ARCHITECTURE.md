# Architecture

## Stack

| Besoin | Choix | Raison |
|---|---|---|
| Rendu vidéo | **Remotion 4** (React) | Animations écrites en code, donc générables et modifiables par Claude ; rendu image par image déterministe |
| Découpe, normalisation, audio | **ffmpeg / ffprobe** | Standard, déjà installé |
| Transcription mot à mot | **whisper.cpp** via `@remotion/install-whisper-cpp` | Local, gratuit, horodatage par mot, bon en français (modèle `large-v3-turbo` ou `medium`) |
| Sous-titres | `@remotion/captions` | Regroupement des mots en pages |
| Schéma et validation | **zod** | Un seul schéma pour valider et typer l'EDL |
| CLI | `tsx` + `commander` | Simple |
| Tests | `vitest` | Tests unitaires sur `resolve` et `validate` |

Vérifier les versions actuelles des paquets au moment de l'installation plutôt que de se fier à ce document.

**Licence Remotion** : gratuit pour les particuliers et les sociétés de 3 personnes ou moins ; au-delà, une licence société est requise. À vérifier avant un usage commercial.

**Pas d'appel API au runtime.** Le directeur est Claude Code lui-même (agent + skill), pas un service. Aucune clé API n'est nécessaire pour monter une vidéo.

## Pipeline

```
reels new <slug>            crée projects/<slug>/
reels ingest <slug>         raw/*  ──► work/source.mp4 (normalisé) + work/audio.wav + work/probe.json
reels transcribe <slug>     audio.wav ──► work/transcript.json   (mots horodatés)
reels analyze <slug>        ──► work/analysis.json + work/frames/*.jpg
        ── le directeur lit analysis.json + frames, écrit edl.json ──
reels validate <slug>       vérifie edl.json (schéma + règles)
reels preview <slug>        rend des images fixes aux instants clés ──► out/preview/*.jpg
reels render <slug>         ──► out/<slug>.mp4
```

### 1. Ingest

- Normaliser toute entrée en H.264, 30 fps constant, audio 48 kHz. Les téléphones filment en fréquence d'images variable, ce qui désynchronise les coupes : cette étape est obligatoire.
- Respecter la rotation des métadonnées. Conserver la résolution d'origine (le recadrage 9:16 est une décision du directeur, pas de l'ingest).
- Extraire `audio.wav` mono 16 kHz pour Whisper.
- Plusieurs fichiers bruts = plusieurs clips, chacun avec un identifiant (`c1`, `c2`…).

### 2. Transcribe

Sortie `transcript.json` :

```json
{ "language": "fr",
  "words": [ { "id": "w1", "clip": "c1", "text": "Bonjour", "start": 0.42, "end": 0.81, "confidence": 0.97 } ] }
```

Les identifiants de mots sont stables : le directeur s'y ancre.

### 3. Analyze

Uniquement des faits mesurés, regroupés dans `analysis.json` :

- `silences` : intervalles sans parole (ffmpeg `silencedetect`, croisé avec les trous entre mots).
- `shots` : changements de plan (ffmpeg `scdetect`).
- `loudness` : LUFS intégré et courbe RMS par tranche de 100 ms (sert à repérer l'emphase).
- `fillers` : mots candidats à la suppression (« euh », « bah », « du coup », répétitions immédiates).
- `retakes` : phrases recommencées (même début de phrase répété à quelques secondes d'écart).
- `sentences` : mots regroupés en phrases avec début et fin.
- `frames` : une image clé par phrase et par changement de plan, dans `work/frames/`.
- `face` : par image clé, boîte englobante du visage en coordonnées normalisées (sert à centrer les zooms et placer les sous-titres). Phase 3 ; avant cela le directeur l'estime en regardant les images.

Le directeur regarde les images clés lui-même pour comprendre la scène (cadrage, décor, gestes, objets montrés).

### 4. Direction

Le directeur produit `edl.json` en suivant `docs/DIRECTOR.md`. Contrat : `docs/EDL.md`.

### 5. Validation, aperçu, rendu

- `validate` : schéma zod + règles (pas de chevauchement de segments, ancres existantes, sous-titres dans la zone sûre, durée totale dans les bornes).
- `preview` : rend une image fixe à chaque événement (entrée d'animation, transition, première page de sous-titres). Le directeur les regarde et corrige l'EDL avant le rendu complet. C'est la boucle de qualité.
- `render` : Remotion lit l'EDL résolu, ffmpeg finalise l'audio (normalisation −14 LUFS).

## Arborescence

```
src/
  cli/                 commandes reels
  pipeline/            ingest.ts, transcribe.ts, analyze.ts
  edl/
    schema.ts          schéma zod, source de vérité
    resolve.ts         secondes source ──► images de sortie, résolution des ancres
    validate.ts        règles au-delà du schéma
  remotion/
    Root.tsx           composition "Reel", props = EDL résolu
    Reel.tsx           empile les pistes : vidéo, overlays, sous-titres, audio
    tracks/            VideoTrack, OverlayTrack, CaptionTrack, AudioTrack
    overlays/          bibliothèque d'animations (un fichier par composant)
    transitions/       un fichier par transition
    captions/          styles de sous-titres
  brand/               brand kits (couleurs, polices, logo)
assets/
  sfx/  music/  fonts/
projects/<slug>/       non commité
  raw/  work/  edl.json  out/
docs/
.claude/agents/  .claude/skills/
```

## Deux modes, un seul moteur

- **Face caméra** : la piste principale est faite de segments `clip` (morceaux du footage).
- **Animation** : la piste principale est faite de segments `scene` (fonds et animations générés), rythmés par une voix off ou par des durées fixes.

Un même Reel peut mélanger les deux. Le rendu ne distingue pas les modes : il lit des segments.

## Extension : ajouter une animation

1. Créer `src/remotion/overlays/<Nom>.tsx` avec un schéma zod de props.
2. L'enregistrer dans `src/remotion/overlays/index.ts`.
3. L'ajouter au catalogue de `docs/DIRECTOR.md` avec « quand l'utiliser ».

Sans l'étape 3, le directeur ne sait pas que l'animation existe.
