# Reels Editor

Éditeur de Reels piloté par Claude Code. Du footage brut ou un script en entrée, un Reel vertical monté en sortie : coupes, zooms, sous-titres mot à mot, animations, transitions, son.

Un directeur de montage (agent Claude) analyse la vidéo et décide de chaque coupe, transition et animation ; un moteur Remotion + ffmpeg exécute ses décisions.

## État

Structure et guide posés. Le code reste à écrire en suivant `docs/ROADMAP.md`.

## Par où commencer

1. Lire `CLAUDE.md`, puis `docs/ARCHITECTURE.md`.
2. Dans Claude Code : « Utilise l'agent builder pour implémenter la phase 0 de la roadmap », puis phase par phase.
3. À partir de la phase 4 : déposer une vidéo dans `projects/<slug>/raw/` et lancer `/edit-reel <slug>`.

## Documents

- `docs/ARCHITECTURE.md` : stack, pipeline, arborescence
- `docs/EDL.md` : format du fichier de montage
- `docs/DIRECTOR.md` : règles de montage du directeur
- `docs/ROADMAP.md` : phases de développement
