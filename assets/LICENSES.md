# Licences des fichiers de assets/

Tout fichier ajouté ici doit pouvoir être redistribué avec le dépôt. Une ligne par fichier.

| Fichier | Origine | Licence |
|---|---|---|
| `fonts/Montserrat-ExtraBold.ttf` | Montserrat, The Montserrat Project Authors (Google Fonts v31, paquet npm `@expo-google-fonts/montserrat` 0.4.2) | SIL Open Font License 1.1, texte complet dans `fonts/Montserrat-OFL.txt` |
| `fonts/Montserrat-Black.ttf` | Montserrat Black, même origine (`@expo-google-fonts/montserrat` 0.4.2, `900Black`) | SIL Open Font License 1.1 (`fonts/Montserrat-OFL.txt`) |
| `fonts/Montserrat-SemiBold.ttf` | Montserrat SemiBold, même origine (`@expo-google-fonts/montserrat` 0.4.2, `600SemiBold`) | SIL Open Font License 1.1 (`fonts/Montserrat-OFL.txt`) |
| `studio/dm-sans.woff2` | DM Sans, The DM Sans Project Authors (Google Fonts) | SIL Open Font License 1.1, texte dans `studio/DM-Sans-OFL.txt` |
| `studio/alpine.jpg`, `studio/forest.jpg`, `studio/lake.jpg` | Photos Unsplash [montagnes](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b), [forêt](https://images.unsplash.com/photo-1472396961693-142e6e269027), [lac](https://images.unsplash.com/photo-1470770841072-f978cf4d019e) | [Unsplash License](https://unsplash.com/license) |
| `studio/alpine-field-notes.mp4`, `studio/sample-cut.mp4`, `studio/poster.jpg`, `studio/strip.jpg`, `studio/sample-cover.jpg` | Montage des trois photos ci-dessus, narration originale synthétisée avec Flite | Photos sous licence Unsplash, montage et narration créés pour ce dépôt |
| `music/drift.m4a`, `sfx/pulse.wav`, `sfx/sweep.wav`, `studio/*.png` | Musique et effets synthétisés pour le studio, formes d’onde générées à partir des enregistrements | CC0-1.0 |

Browser OCR uses the Apache-2.0 Tesseract.js and Tesseract.js-core distributions and English language data from the @tesseract.js-data/eng npm package. The build includes the core license and the bundled worker’s redistribution notices beside the engine. [Tesseract.js](https://github.com/naptha/tesseract.js) · [Training data](https://github.com/naptha/tessdata)

Browser face framing uses Nenad Markus’s MIT-licensed picojs implementation at afffa50ec4134a47005f2cbf8112eaa69f65f37e and the official pico facefinder cascade at c2e81f9d23cc11d1a612fd21e4f9de0921a5d0d9. The MIT notice ships beside both files. [picojs](https://github.com/nenadmarkus/picojs) · [pico](https://github.com/nenadmarkus/pico)

Portrait matting bundles an Apache-2.0 MODNet ONNX conversion from the pinned Xenova/modnet revision documented in the validation report and the MIT-licensed ONNX Runtime Web engine. Corresponding notices are shipped alongside the model. The example NASA portrait of Eileen Collins is in the public domain. [Model and runtime provenance](../docs/PORTRAIT-MATTES.md)
