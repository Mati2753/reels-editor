# Reels Editor

Éditeur de Reels piloté par Claude Code. Du footage brut ou un script en entrée, un Reel vertical monté en sortie : coupes, zooms, sous-titres mot à mot, animations, transitions, son.

Un directeur de montage (agent Claude) analyse la vidéo et décide de chaque coupe, transition et animation ; un moteur Remotion + ffmpeg exécute ses décisions.

## État

Phase 0 (socle) en place : CLI `reels new <slug>`, composition Remotion `Reel` vide (1080×1920, 30 fps), tests.

Phase 1 (faits) en place : `reels ingest`, `reels transcribe` (faster-whisper, à installer côté Python : voir `docs/ARCHITECTURE.md`), `reels analyze`, vérifiés sur un footage synthétique (`scripts/synthetic/`). Reste ouvert : l'horodatage des mots n'atteint pas ±0,05 s sur toute la parole enchaînée (environ un mot sur trois dans la tolérance, écart médian au début des mots 0,05 s) ; à mesurer sur un vrai tournage.

Phase 2 (premier Reel : coupes + sous-titres) en place : le contrat EDL (`src/edl/schema.ts`, `docs/EDL.md`), `resolve` et `validate` avec leurs tests, la composition Remotion (piste vidéo avec recadrage 9:16, punch-ins et zooms progressifs ; sous-titres mot à mot avec emphase, corrections et zone sûre), le brand kit par défaut (police Montserrat embarquée), et `reels validate`, `reels preview`, `reels render` (voix normalisée à −14 LUFS). Exemple de référence : `examples/demo/edl.json`, vérifié sur le footage synthétique par `scripts/synthetic/check-render.ts` (durée à l'image près, aucun mot coupé, son de chaque segment à 0 ms de sa place, synchronisation son/image conservée, cibles de cadrage à 1,1 px au plus de leur position prévue, sans bande noire). Limites : le mot surligné suit les bornes de mots de la phase 1, en moyenne 57 ms en avance sur la voix (jusqu'à 176 ms entre mots enchaînés) ; un mot de remplissage collé au mot suivant laisse 20 à 30 ms de sa fin ; transitions, overlays, musique et effets sonores sont refusés par `validate` jusqu'aux phases 3 et 5. Pour `preview` et `render` sur une machine sans accès au téléchargement de Chrome, définir `REELS_BROWSER_EXECUTABLE`.

La suite se construit en suivant `docs/ROADMAP.md`.

## Par où commencer

1. Lire `CLAUDE.md`, puis `docs/ARCHITECTURE.md`.
2. Dans Claude Code : « Utilise l'agent builder pour implémenter la phase 2 de la roadmap », puis phase par phase.
3. À partir de la phase 4 : déposer une vidéo dans `projects/<slug>/raw/` et lancer `/edit-reel <slug>`.

## Documents

- `docs/ARCHITECTURE.md` : stack, pipeline, arborescence
- `docs/EDL.md` : format du fichier de montage
- `docs/DIRECTOR.md` : règles de montage du directeur
- `docs/ROADMAP.md` : phases de développement
