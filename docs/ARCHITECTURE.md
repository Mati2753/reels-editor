# Architecture

## Stack

| Besoin | Choix | Raison |
|---|---|---|
| Rendu vidéo | **Remotion 4** (React) | Animations écrites en code, donc générables et modifiables par Claude ; rendu image par image déterministe |
| Découpe, normalisation, audio | **ffmpeg / ffprobe** | Standard, déjà installé |
| Transcription mot à mot | **faster-whisper** (Whisper sur CTranslate2, Python), appelé par `src/pipeline/whisper.py` | Local, gratuit, horodatage par mot ; `pip install` sans compilateur sur Mac, Windows et Linux ; modèles téléchargés depuis Hugging Face. Choix et mesures : section « Transcribe » |
| Sous-titres | `@remotion/captions` | Regroupement des mots en pages |
| Schéma et validation | **zod** | Un seul schéma pour valider et typer l'EDL |
| CLI | `tsx` + `commander` | Simple |
| Tests | `vitest` | Tests unitaires sur `resolve` et `validate` |

Vérifier les versions actuelles des paquets au moment de l'installation plutôt que de se fier à ce document.

Toutes les dépendances `remotion` et `@remotion/*` sont épinglées à la même version exacte. Commandes de base : `npm run reels -- <commande>` (ou `npx reels <commande>`), `npm run studio`, `npm test`, `npm run typecheck`.

**Côté Python** (transcription uniquement) : `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (Windows : `.venv\Scripts\pip`). `reels transcribe` utilise `REELS_PYTHON` s'il est défini, sinon `.venv/`, sinon `python3`. `.venv/` n'est pas commité. Sur une machine sans Chrome téléchargé par Remotion, passer `--browser-executable=<chemin>` aux commandes `remotion still` / `remotion render`.

**Licence Remotion** : gratuit pour les particuliers et les sociétés de 3 personnes ou moins ; au-delà, une licence société est requise. À vérifier avant un usage commercial.

**Pas d'appel API au runtime.** Le directeur est Claude Code lui-même (agent + skill), pas un service. Aucune clé API n'est nécessaire pour monter une vidéo.

## Pipeline

```
reels new <slug>            crée projects/<slug>/
reels ingest <slug>         raw/*  ──► work/<clip>/source.mp4 (normalisé) + work/<clip>/audio.wav + work/probe.json
reels transcribe <slug>     work/<clip>/audio.wav ──► work/transcript.json   (mots horodatés)
reels analyze <slug>        ──► work/analysis.json + work/frames/*.jpg
        ── le directeur lit analysis.json + frames, écrit edl.json ──
reels validate <slug>       vérifie edl.json (schéma + règles)
reels preview <slug>        rend des images fixes aux instants clés ──► out/preview/*.jpg
reels render <slug>         ──► out/<slug>.mp4
```

### Idempotence

Chaque étape note dans `work/.state/<étape>.json` l'empreinte (sha256) de tout ce dont dépend chaque unité de travail : contenu des entrées, options, version de l'algorithme (constante `*_VERSION` en tête du fichier de l'étape, à incrémenter quand on change une règle). Une unité n'est refaite que si son empreinte change ou si ses sorties manquent ; les fichiers JSON ne sont réécrits que si leur contenu change.

| Étape | Unité | Refaite quand change |
|---|---|---|
| ingest | un clip | le contenu du fichier brut, les réglages d'encodage |
| transcribe | un clip | `audio.wav` du clip, le modèle, la langue, le prompt (dont `glossary.txt`), la largeur de faisceau, le type de calcul |
| analyze, mesures lourdes | un clip | `source.mp4` / `audio.wav` du clip, seuil de plans, seuil de silence forcé (cache `work/<clip>/media.json`) |
| analyze, règles sur les mots | le projet | `transcript.json`, les clips, les paramètres |
| analyze, images clés | une image | son instant ; toutes les images d'un clip si `source.mp4` change |

### 1. Ingest

- Normaliser toute entrée en H.264 (`libx264 -crf 18`, image clé toutes les 15 images), 30 fps constant (`fps=30` : images dupliquées ou retirées selon leurs horodatages), audio AAC 48 kHz. Les téléphones filment en fréquence d'images variable, ce qui désynchronise les coupes : cette étape est obligatoire.
- Respecter la rotation des métadonnées : ffmpeg l'applique aux pixels, la sortie n'en porte plus. Conserver la résolution d'origine (le recadrage 9:16 est une décision du directeur, pas de l'ingest). Les dimensions impaires sont arrondies au pair inférieur (exigence de yuv420p).
- Ne pas utiliser `-avoid_negative_ts` : il décale les débuts des flux (mesuré : vidéo à 0,066 s, audio à 0,045 s) et `audio.wav` perdrait ce décalage.
- Extraire `audio.wav` mono 16 kHz PCM **depuis la vidéo normalisée**, pour Whisper et l'analyse : même ligne de temps que l'image.
- Plusieurs fichiers bruts = plusieurs clips, chacun avec un identifiant (`c1`, `c2`…) attribué dans l'ordre des noms et conservé ensuite ; un nouveau fichier prend le numéro suivant, un numéro retiré n'est jamais réutilisé.
- Un fichier sans piste audio reçoit une piste silencieuse.

Sorties : `work/<clip>/source.mp4`, `work/<clip>/audio.wav`, et `work/probe.json` :

```json
{ "version": 1,
  "clips": [ { "id": "c1", "file": "IMG_1234.MOV", "sha256": "…",
    "raw": { "codec": "hevc", "width": 1920, "height": 1080, "rotation": 90, "fps": 29.87, "nominalFps": 30,
             "variableFrameRate": true, "frameInterval": { "min": 0.017, "max": 0.05 }, "duration": 41.2,
             "audio": { "codec": "aac", "sampleRate": 44100, "channels": 2 } },
    "normalized": { "video": "c1/source.mp4", "audio": "c1/audio.wav", "width": 1080, "height": 1920,
                    "fps": 30, "frames": 1236, "duration": 41.2, "audioSampleRate": 48000 } } ] }
```

`rotation` est la rotation demandée par les métadonnées (degrés, sens antihoraire) ; `variableFrameRate` est vrai si l'écart entre deux images varie de plus de 2 ms. Ingest vérifie après encodage que la sortie est à 30 fps constant, en 48 kHz et sans rotation, et échoue sinon. Limite connue : la vidéo HDR (HLG/PQ des iPhone) est convertie en yuv420p 8 bits sans adaptation de tons.

### 2. Transcribe

Moteur : **faster-whisper** (`requirements.txt`), modèles Whisper convertis pour CTranslate2, téléchargés depuis Hugging Face au premier usage (cache `~/.cache/huggingface`, jamais dans le dépôt).

Pourquoi pas whisper.cpp via `@remotion/install-whisper-cpp` : mesuré sur le clip principal du footage synthétique (`scripts/synthetic/`, 54 mots de vérité), à modèle égal (`small`, CPU), bornes brutes du moteur avant recalage :

| Moteur | Écart médian début / fin | Écart max début / fin |
|---|---|---|
| whisper.cpp 1.9.1, horodatage par jeton (`offsets`) | 0,21 s / 0,17 s | 0,91 s / 1,13 s |
| whisper.cpp 1.9.1, `--dtw small` (`t_dtw`) | 0,07 s / 0,05 s | 1,07 s / 0,93 s |
| faster-whisper 1.2.1, `word_timestamps` | 0,06 s / 0,04 s | 0,31 s / 0,29 s |

La médiane est la même (même algorithme DTW sur les têtes d'attention), mais faster-whisper n'a pas les erreurs d'une seconde de whisper.cpp et regroupe lui-même les jetons en mots. Surtout, il s'installe partout avec `pip`, sans compilateur ni accès à GitHub, alors que `@remotion/install-whisper-cpp` clone et compile whisper.cpp depuis GitHub (et, sur Windows, télécharge un binaire qui ne dépasse pas la version 1.6.0). Le coût : une dépendance Python et pas d'accélération Metal sur Mac (le CPU suffit pour des Reels de moins de 90 s).

Réglages (`reels transcribe <slug> --help`) :

- `--model` / `REELS_WHISPER_MODEL` : `large-v3-turbo` par défaut (qualité finale) ; `small` ou `base` pour les tests rapides. Tout nom accepté par faster-whisper ou chemin de modèle CTranslate2.
- `--language` / `REELS_LANGUAGE` : `fr` par défaut.
- `--device`, `--compute-type` (`REELS_WHISPER_DEVICE`, `REELS_WHISPER_COMPUTE_TYPE`), `--beam-size` (5), `--python` (`REELS_PYTHON`).
- Prompt initial : en français, une phrase au style parlé (« Euh, bon, alors… ») pour que Whisper garde les hésitations au lieu de les effacer ; suivie du glossaire du projet s'il existe (`projects/<slug>/glossary.txt`, un terme par ligne : noms propres, marques).
- Température 0 uniquement : même audio, mêmes mots.

Sortie brute du moteur par clip dans `work/<clip>/whisper.json` (cache), puis `transcript.json` :

```json
{ "language": "fr",
  "engine": { "name": "faster-whisper 1.2.1", "model": "large-v3-turbo" },
  "words": [ { "id": "c1-w1", "clip": "c1", "text": "Bonjour", "start": 0.42, "end": 0.81, "confidence": 0.97 } ] }
```

Les élisions et pronoms que Whisper coupe en morceaux sont recollés (« aujourd » + « 'hui » → « aujourd'hui », « Mettez » + « -vous » → « Mettez-vous ») ; la ponctuation reste attachée au mot. Les identifiants de mots sont stables : l'identifiant du clip suivi du rang du mot dans ce clip (`c1-w12`, `c2-w3`). Retranscrire un clip (nouveau modèle, nouvel audio) ne change que les identifiants de ce clip, jamais ceux des autres ; `validate` signale alors les ancres devenues invalides. Le directeur s'y ancre.

Les bornes de `transcript.json` sont celles de Whisper. Les bornes recalées sur l'audio sont dans `analysis.json` (`words`) : ce sont elles qu'il faut utiliser pour couper et pour synchroniser les sous-titres.

### 3. Analyze

Uniquement des faits mesurés, regroupés dans `analysis.json`. Temps en secondes dans le clip normalisé, arrondis à la milliseconde. Identifiants : `sil`, `snd`, `sh`, `tr`, `f`, `r`, `s`, `k` suivis d'un numéro.

- `words` : chaque mot avec ses bornes **recalées sur l'énergie audio** là où il touche une pause (parade au risque « Whisper décale les mots dans les longs silences » de la roadmap). Régions sonores = trames de 10 ms au-dessus du seuil de silence, sons de moins de 20 ms ignorés, creux de moins de 100 ms comblés. Un début placé dans le silence avance jusqu'au dernier son qui commence dans le mot (un clap ou une respiration avant le mot est sauté) ; un début placé dans le son recule jusqu'au début de ce son s'il est à moins de 0,5 s et après le mot précédent ; même chose, en miroir, pour la fin. Entre deux mots enchaînés sans pause, rien ne bouge. `raw` garde les bornes de Whisper quand elles ont été déplacées.
- `silences` : intervalles silencieux d'après ffmpeg `silencedetect` (seuil par clip, voir `loudness`), privés des intervalles des mots, d'au moins `minSilence` (0,25 s) ; `after` / `before` : mots qui les encadrent.
- `sounds` : intervalles non silencieux qu'aucun mot ne couvre, d'au moins 80 ms (clap, respiration, hésitation non transcrite, bruit). `isolated` : silence des deux côtés ; sinon le son touche un mot et prolonge souvent ce mot au-delà des bornes de Whisper.
- `shots` : plans d'après ffmpeg `scdet` (seuil 10 sur 100) ; `cutScore` : score de la coupe qui ouvre le plan.
- `transients` : changements d'image brefs (moins de 0,5 s) après lesquels l'image revient à l'identique (flash, glitch, main devant l'objectif) : ce ne sont pas des plans.
- `loudness` : par clip, LUFS intégré, plage de loudness et crête vraie (ffmpeg `ebur128`), courbe RMS en dBFS par tranche de 100 ms (sert à repérer l'emphase), et le seuil de silence retenu : 15 dB au-dessus du plancher de bruit (10ᵉ centile des trames de 10 ms), borné à [−60, −35] dBFS ; `--silence-db` le force.
- `fillers` : mots candidats à la suppression, avec leurs identifiants de mots. `hesitation` : « euh », « heu », « hum », « e » (Whisper écrit souvent « euh » ainsi)… ; `discourse` : « du coup », « en fait », « voilà », « bah », « ben » ; `repetition` : répétition immédiate d'un groupe d'un à trois mots (« ça change ça change »), sauf « nous nous » / « vous vous ». Ce sont des candidats : la décision de couper appartient au directeur.
- `retakes` : phrases recommencées. Un point de reprise est un début de phrase ou un mot après une pause d'au moins 0,3 s ; si les mots à partir d'un point de reprise répètent, sur au moins deux mots, ceux d'un point de reprise précédent du même clip (moins de 10 s avant), et que la tentative n'a pas plus de quatre mots au-delà de la partie répétée, la tentative (`attempt`) est abandonnée et `restart` est le début de la nouvelle.
- `sentences` : mots regroupés en phrases (ponctuation finale de Whisper, ou pause d'au moins 1 s, ou fin de clip) avec début, fin, premier et dernier mot, texte.
- `frames` : une image clé par phrase (au milieu) et par plan (0,5 s après son début, ou son milieu s'il est plus court), dans `work/frames/<clip>-f<numéro d'image>.jpg`, 540 px de large.
- `face` : par image clé, boîte englobante du visage en coordonnées normalisées (sert à centrer les zooms et placer les sous-titres). Phase 3 ; avant cela le directeur l'estime en regardant les images.

Le schéma zod de ces trois fichiers est dans `src/pipeline/schemas.ts`.

Le directeur regarde les images clés lui-même pour comprendre la scène (cadrage, décor, gestes, objets montrés).

### Footage de test

`scripts/synthetic/generate.py` fabrique un footage français dont on connaît la vérité terrain (voix Piper, phrases placées à des instants connus, silences de durée connue, « euh », répétition, phrase recommencée, changement de plan, claps image + son ; un clip en fréquence d'images variable, un clip à 25 fps avec rotation 90°) et l'écrit dans `projects/<slug>/raw/` avec `projects/<slug>/truth.json`. `scripts/synthetic/check.ts` compare ensuite `probe.json`, `transcript.json` et `analysis.json` à cette vérité. Mode d'emploi en tête de chaque fichier. Une voix de synthèse est plus facile à transcrire qu'une vraie voix : ces mesures ne garantissent pas la précision sur un vrai tournage.

### 4. Direction

Le directeur produit `edl.json` en suivant `docs/DIRECTOR.md`. Contrat : `docs/EDL.md`.

### 5. Validation, aperçu, rendu

- `validate` : schéma zod + règles (pas de chevauchement de segments, ancres existantes, sous-titres dans la zone sûre, durée totale dans les bornes).
- `preview` : rend une image fixe à chaque événement (entrée d'animation, transition, première page de sous-titres). Le directeur les regarde et corrige l'EDL avant le rendu complet. C'est la boucle de qualité.
- `render` : Remotion lit l'EDL résolu, ffmpeg finalise l'audio (normalisation −14 LUFS).

## Arborescence

```
bin/reels.js           exécutable `reels` (charge src/cli/ via tsx, sans étape de build)
remotion.config.ts     configuration Remotion (point d'entrée)
src/
  cli/                 commandes reels (index.ts : programme commander ; une commande par fichier)
  pipeline/            ingest.ts, transcribe.ts (+ whisper.py), analyze.ts, schemas.ts
    analysis/          règles pures (mots, phrases, silences, recalage) et mesures ffmpeg
  edl/
    schema.ts          schéma zod, source de vérité
    resolve.ts         secondes source ──► images de sortie, résolution des ancres
    validate.ts        règles au-delà du schéma
  remotion/
    index.ts           point d'entrée Remotion (registerRoot)
    Root.tsx           composition "Reel", props = EDL résolu
    Reel.tsx           empile les pistes : vidéo, overlays, sous-titres, audio
    tracks/            VideoTrack, OverlayTrack, CaptionTrack, AudioTrack
    overlays/          bibliothèque d'animations (un fichier par composant)
    transitions/       un fichier par transition
    captions/          styles de sous-titres
  brand/               brand kits (couleurs, polices, logo)
assets/
  sfx/  music/  fonts/
scripts/synthetic/     footage de test à vérité terrain connue + vérification
requirements.txt       dépendances Python (transcription)
projects/<slug>/       non commité
  raw/  work/  edl.json  out/  glossary.txt (optionnel)
  work/                probe.json transcript.json analysis.json frames/ .state/ <clip>/{source.mp4,audio.wav,whisper.json,media.json}
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
