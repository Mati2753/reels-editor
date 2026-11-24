# Reels Editor

Éditeur de Reels piloté par Claude Code : il transforme du footage brut (face caméra) ou un simple script en Reel vertical fini (1080×1920, 30 fps) avec coupes, zooms, sous-titres, animations, transitions et son.

Cutroom (`npm run editor`) fournit l’interface locale de montage. Le directeur local ou Claude Code choisit les coupes et écrit un fichier `edl.json`. Le moteur déterministe exécute ce fichier. Le studio et la CLI partagent les projets, les faits, le validateur et le rendu. Voir `docs/STUDIO.md` et la commande Claude Code `/review-edit <slug>`.

## Principe central

```
footage brut ──► analyse (faits) ──► directeur (décisions) ──► edl.json ──► rendu (pixels)
```

- **L'analyse ne décide rien.** Elle produit des faits : mots horodatés, silences, changements de plan, images clés, niveaux audio.
- **Le directeur ne touche pas aux pixels.** Il lit les faits et écrit l'EDL. Tout son savoir-faire est dans `docs/DIRECTOR.md`.
- **Le rendu ne décide rien.** Même EDL = même vidéo, à chaque fois.

Cette séparation est la règle la plus importante du projet. Une décision de montage codée en dur dans le rendu, ou un calcul de pixels fait par le directeur, est un bug d'architecture.

## Documents

| Fichier | Contenu | À lire quand |
|---|---|---|
| `docs/ARCHITECTURE.md` | Stack, pipeline, arborescence, formats de fichiers | Avant tout développement |
| `docs/EDL.md` | Le contrat `edl.json` entre directeur et rendu | Avant de toucher au schéma, au rendu ou au directeur |
| `docs/DIRECTOR.md` | Règles de montage : coupes, rythme, zooms, transitions, sous-titres, animations, son | Avant de monter une vidéo ou de modifier le directeur |
| `docs/ROADMAP.md` | Phases de développement et critères d'acceptation | Pour savoir quoi construire ensuite |

## Rôles

- **Structure, guide, direction de montage** : agent `director` (`.claude/agents/director.md`).
- **Développement et code** : agent `builder` (`.claude/agents/builder.md`).

Le builder implémente la roadmap en respectant les documents ; il ne change pas le contrat EDL ni les règles de montage sans mettre à jour le document correspondant dans le même commit.

## Conventions

- TypeScript strict, Node 22, ESM. Pas de `any` dans `src/edl/`.
- Le schéma zod de `src/edl/schema.ts` est la source de vérité ; `docs/EDL.md` l'explique. Les deux changent ensemble.
- Temps en **secondes** (nombre décimal) dans tous les fichiers JSON. La conversion en images se fait à un seul endroit : `src/edl/resolve.ts`.
- Chaque étape du pipeline est une commande CLI idempotente qui lit et écrit des fichiers dans `projects/<slug>/`. Relancer une étape ne refait que ce qui a changé.
- `projects/` n'est jamais commité (vidéos lourdes, contenu privé).
- Tout composant d'animation est paramétré par props et par le brand kit ; aucune couleur ni police en dur.
- Une fonctionnalité de rendu n'est terminée que lorsqu'une image de test a été rendue et regardée.
