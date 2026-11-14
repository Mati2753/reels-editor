# Roadmap

Chaque phase se termine par un résultat visible et vérifiable. Ne pas commencer une phase avant que les critères de la précédente soient remplis. Un commit par étape cohérente.

Pour tester, placer une vidéo face caméra de 30 à 60 s dans `projects/demo/raw/`.

## Phase 0 : socle

- `package.json` (Node 22, ESM, TypeScript strict), Remotion, zod, vitest, commander, tsx.
- Arborescence de `docs/ARCHITECTURE.md`.
- CLI `reels` avec `new <slug>`.
- Composition Remotion `Reel` vide en 1080×1920, 30 fps.

**Fait quand :** `npx remotion studio` s'ouvre, `reels new demo` crée le dossier, `npm test` et `tsc --noEmit` passent.

## Phase 1 : faits

- `reels ingest` : normalisation ffmpeg (30 fps constant, rotation), `probe.json`, `audio.wav`.
- `reels transcribe` : whisper.cpp, mots horodatés avec identifiants stables.
- `reels analyze` : silences, plans, niveaux, mots de remplissage, prises répétées, phrases, images clés.

**Fait quand :** sur la vidéo de démo, `analysis.json` est complet, les horodatages des mots sont justes à ±0,05 s sur dix mots vérifiés à la main, et relancer une commande sans changement ne refait rien.

## Phase 2 : premier Reel (coupes + sous-titres)

- `src/edl/schema.ts`, `resolve.ts`, `validate.ts` avec tests unitaires (ancres, conversion en images, chevauchements).
- `VideoTrack` : segments `clip` avec `framing` (échelle, origine, zoom progressif).
- `CaptionTrack` : un style, mot actif surligné, emphase, zone sûre.
- `reels validate`, `reels preview`, `reels render`.
- Brand kit par défaut (couleurs, police, marges de zone sûre).

**Fait quand :** un `edl.json` écrit à la main donne un MP4 où les silences sont coupés sans mot tronqué, les sous-titres sont synchronisés au mot, et les punch-ins sont centrés sur le visage.

C'est le produit minimum : à partir d'ici le directeur peut déjà monter un Reel propre.

## Phase 3 : mouvement

- Transitions : `fade`, `slide`, `whip`, `zoom`, `flash`, `glitch`.
- Overlays, dans cet ordre : `HookTitle`, `KeywordPop`, `BigNumber`, `ListReveal`, `CtaCard`, `SectionTitle`, `LabelTag`, puis `SplitCompare`, `StepFlow`, `QuoteCard`, `ChatBubble`, `ChartGrow`, `LogoCard`, `ScreenMock`.
- Chaque overlay : schéma de props zod, entrée et sortie animées, respect du brand kit et de la zone sûre.
- Détection du visage dans `analyze` (boîte englobante par image clé).
- Page de galerie dans Remotion Studio montrant chaque overlay avec des props d'exemple.

**Fait quand :** chaque composant a été rendu en image fixe et regardé, dans les zones `top`, `center` et `full`.

## Phase 4 : le directeur

- Skill `/edit-reel <slug>` : enchaîne ingest → transcribe → analyze, confie la direction à l'agent `director`, puis validate → preview → corrections → render.
- Le directeur applique les passes de `docs/DIRECTOR.md` et la liste de vérification avant rendu.
- Commandes de retouche en langage naturel : « raccourcis à 30 s », « enlève l'animation à 0:12 », « sous-titres plus gros » modifient l'EDL sans tout refaire.

**Fait quand :** depuis un fichier brut et une seule commande, on obtient un Reel publiable sans retouche manuelle sur trois vidéos de test différentes.

## Phase 5 : son

- `AudioTrack` : musique avec abaissement automatique sous la voix, effets sonores ancrés.
- Bibliothèque `assets/sfx/` et `assets/music/` (sons libres de droits uniquement, licence notée dans `assets/LICENSES.md`).
- Normalisation finale −14 LUFS, réduction de bruit optionnelle.

**Fait quand :** la voix reste intelligible sur toute la durée et le niveau mesuré du fichier final est à −14 LUFS ±1.

## Phase 6 : mode animation

- Segments `scene` avec fonds (couleur, dégradé, image, vidéo).
- Skill `/animate-reel` : script → découpage en scènes → EDL.
- Voix off : fichier fourni par l'utilisateur, ou synthèse en option.

**Fait quand :** un script de 80 mots donne un Reel animé complet sans footage.

## Phase 7 : au-delà

- Plusieurs brand kits et styles de sous-titres.
- B-roll : dossier de médias de l'utilisateur, ou génération d'images et de vidéos (connecteur Higgsfield).
- Plusieurs caméras ou prises dans un même Reel.
- Déclinaisons : 9:16, 1:1, 16:9 depuis le même EDL.
- Gabarits de Reels réutilisables (conseil en 3 points, avant/après, étude de cas).

## Risques connus

| Risque | Parade |
|---|---|
| Fréquence d'images variable des téléphones | Normalisation obligatoire à l'ingest |
| Whisper décale les mots dans les longs silences | Recaler les bornes de mots sur l'énergie audio dans `analyze` |
| Coupes qui tronquent un mot | Marges de coupe + écoute des jonctions à l'aperçu |
| Rendu lent | Aperçu en images fixes d'abord ; rendu complet une seule fois |
| Noms propres mal transcrits | Glossaire par projet passé à Whisper + `overrides` |
