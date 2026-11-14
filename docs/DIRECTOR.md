# Le directeur : règles de montage

Ce document est le savoir-faire du directeur. Il dit quand couper, quand zoomer, quand faire entrer une animation, comment sous-titrer. Les valeurs chiffrées sont des points de départ : le directeur les adapte au contenu et note ses écarts dans `edl.notes`.

## Méthode

1. **Lire** toute la transcription. Résumer en une phrase ce que la vidéo promet au spectateur.
2. **Regarder** les images clés : cadrage, position du visage, décor, objets montrés, gestes.
3. **Structurer** : accroche, développement en 2 à 4 temps, chute ou appel à l'action.
4. **Couper** (passe 1) : ne garder que ce qui sert la promesse.
5. **Rythmer** (passe 2) : cadrages, zooms, transitions.
6. **Illustrer** (passe 3) : animations, titres, b-roll.
7. **Sous-titrer** (passe 4) : corrections, emphase, position.
8. **Sonoriser** (passe 5) : musique, effets.
9. **Vérifier** : `validate`, `preview`, regarder chaque image d'aperçu, corriger, puis seulement rendre.

Chaque passe modifie l'EDL. Ne pas essayer de tout décider en une fois.

## 1. Accroche (0 à 3 secondes)

Le spectateur décide de rester en moins de trois secondes.

- La première phrase est la plus forte de la vidéo, pas la première prononcée. Si la meilleure phrase est au milieu, la déplacer au début.
- Premier mot prononcé avant 0,3 s. Aucune respiration, aucun « alors », aucun « bonjour ».
- Un titre à l'écran dès la première image, 3 à 7 mots, qui dit ce qu'on va apprendre.
- Un mouvement dans la première seconde : zoom progressif ou entrée animée du titre.

## 2. Coupes

**Supprimer :**
- Les silences de plus de 0,35 s : les ramener à 0,08–0,15 s.
- Les mots de remplissage (« euh », « bah », « en fait », « du coup », « voilà ») quand la coupe est propre.
- Les prises ratées : quand une phrase est recommencée, garder la dernière version complète.
- Les redites et les digressions qui ne servent pas la promesse.

**Comment couper :**
- Couper dans le silence, 0,05 à 0,08 s avant l'attaque du mot et 0,08 à 0,12 s après sa fin. Jamais au milieu d'un mot ni d'une respiration audible.
- Laisser respirer après une phrase importante (0,3 à 0,4 s). Un montage sans aucune pause fatigue ; la pause gardée exprès a du poids.
- Si supprimer un mot de remplissage produit un saut audible, le garder.

**Durée cible :** 20 à 45 s pour un conseil, jusqu'à 60–90 s pour une histoire. Si le premier montage dépasse, couper du contenu plutôt qu'accélérer.

## 3. Cadrage et zooms

Chaque coupe dans un plan fixe produit un saut visible. On le rend intentionnel en changeant d'échelle.

- Alterner les échelles entre segments consécutifs : 1,0 → 1,15 → 1,0 → 1,25. Écart minimum de 0,12, sinon le saut ressemble à une erreur.
- Centrer le zoom sur les yeux (`origin` légèrement au-dessus du centre du visage).
- **Punch-in sec** (changement d'échelle à la coupe) : sur une affirmation forte, un chiffre, une chute.
- **Zoom lent** (`move`, +4 à +8 % sur le segment) : sur une explication, une montée de tension.
- **Retour au plan large** : au début d'une nouvelle idée.
- Échelle maximale 1,4 sur une source 1080p, 1,8 sur une source 4K. Au-delà l'image est floue.

**Règle de rythme visuel :** quelque chose change à l'écran toutes les 2 à 4 secondes (coupe, échelle, overlay, b-roll). Plus de 5 secondes d'image identique est un défaut, sauf moment d'émotion voulu.

## 4. Transitions

La coupe franche est la transition par défaut et représente environ 90 % des jonctions. Une transition visible signifie quelque chose ; l'utiliser sans raison l'use.

| Situation | Transition | Durée |
|---|---|---|
| Même idée, phrase suivante | `cut` + changement d'échelle | 0 |
| Nouvelle partie, nouveau point d'une liste | `whip` ou `slide` | 0,2–0,3 s |
| Vers ou depuis un b-roll ou une animation plein écran | `cut`, ou `zoom` | 0–0,25 s |
| Avant / après, révélation | `flash` | 0,1–0,15 s |
| Changement de lieu ou de moment | `fade` | 0,3–0,5 s |
| Rupture de ton, humour, erreur | `glitch` | 0,15–0,2 s |

- Maximum 1 transition visible par tranche de 8 secondes.
- Un seul style de transition de section par Reel (tout en `whip` ou tout en `slide`).
- Toute transition visible est accompagnée d'un effet sonore.

## 5. Animations et overlays

**Déclencheurs : quand ce qui est dit se voit mieux qu'il ne s'entend.**

| Ce qui est dit | Overlay | Zone |
|---|---|---|
| Un chiffre, un prix, un pourcentage | `BigNumber` (compteur animé) | center ou top |
| Une liste (« trois erreurs », « d'abord… ensuite ») | `ListReveal` (un item par mention) | top ou full |
| Une comparaison, un avant / après | `SplitCompare` | full |
| Un processus, des étapes | `StepFlow` | full |
| Un mot-clé, un concept à retenir | `KeywordPop` | top |
| Un nom, une marque, un lieu, un outil | `LabelTag` ou `LogoCard` | top |
| Une évolution, une donnée | `ChartGrow` | full |
| Une citation, un message, un commentaire | `QuoteCard` / `ChatBubble` | center |
| Un site, une app, un écran | `ScreenMock` (b-roll) | full |
| L'accroche | `HookTitle` | top |
| L'appel à l'action final | `CtaCard` | bottom ou full |
| Changement de partie | `SectionTitle` | full |

Ce catalogue est la liste de référence des composants à construire (voir `ROADMAP.md`). Tout nouveau composant y est ajouté.

**Synchronisation :**
- L'overlay s'ancre sur le mot qui le justifie et entre 2 à 4 images avant (`offset: -0.1`). L'œil doit voir l'élément au moment où l'oreille entend le mot.
- Dans une liste, chaque item apparaît sur son propre mot, pas tous ensemble.
- Durée : assez pour être lu deux fois. Compter 0,3 s par mot affiché, minimum 1,2 s, maximum 4 s.
- Sortie avant la phrase suivante, ou sur une coupe.

**Dosage :**
- Une seule idée à l'écran à la fois. Jamais deux overlays chargés simultanément.
- 6 mots maximum par overlay, sous-titres exclus.
- Plein écran : 1,5 à 4 s, puis retour au visage. Le visage reste à l'écran au moins 50 % du Reel en mode face caméra : c'est lui qui crée la confiance.
- Une phrase d'émotion ou de conviction se joue sur le visage, sans rien par-dessus.

**Mouvement :**
- Entrées rapides avec amorti (ressort, 8 à 12 images). Sorties plus rapides que les entrées (4 à 6 images).
- Les éléments viennent d'une direction cohérente dans tout le Reel.
- Pas de mouvement linéaire : toujours une courbe d'accélération.

## 6. Sous-titres

Une grande partie des Reels est regardée sans le son ; les sous-titres sont obligatoires sauf demande contraire.

- 2 à 4 mots par page, une ligne de préférence, deux au maximum. Environ 18 caractères par ligne.
- Ne jamais séparer un article de son nom, ni un nombre de son unité. Couper les pages aux limites de sens.
- Mot actif mis en valeur (couleur ou échelle) au moment où il est prononcé.
- 1 à 2 mots d'emphase par phrase au maximum, en couleur de marque : les mots qui portent le sens (chiffres, verbes d'action, négations).
- Relire toute la transcription : corriger noms propres, marques, chiffres, accords via `overrides`. Une faute dans un sous-titre décrédibilise la vidéo.
- Police grasse sans empattement, 60 à 80 px, contour ou ombre pour rester lisible sur tout fond.
- Position : sous le menton en plan large (`lower-third`), jamais sur la bouche ni les yeux. Quand un overlay occupe la zone, les sous-titres se déplacent ou sont masqués (`hide`).

**Zone sûre (1080×1920).** L'interface d'Instagram recouvre les bords. Aucun texte en dehors de :

- haut : 250 px
- bas : 420 px (légende, nom du compte, audio)
- droite : 130 px (boutons)
- gauche : 60 px

Ces marges sont dans le brand kit et se règlent à un seul endroit.

## 7. Son

- Voix : normalisée à −14 LUFS, réduction de bruit si le fond est audible.
- Musique : −22 à −26 dB sous la voix, abaissée automatiquement quand la voix parle (`duck`), fondu de sortie de 0,5 à 1 s. Choisir un tempo qui correspond au débit ; caler les changements de partie sur les temps forts quand c'est possible.
- Effets sonores, discrets (−12 à −18 dB) :
  - `whoosh` sur les transitions `whip`, `slide`, `zoom`
  - `pop` ou `click` à l'entrée d'un overlay
  - `riser` avant une révélation
  - `ding` sur un chiffre ou une réussite
- Pas d'effet sur chaque coupe : 1 effet toutes les 3 à 5 secondes au maximum.

## 8. Fin

- Terminer sur la phrase la plus utile ou sur un appel à l'action unique (« abonne-toi », « commente X », « enregistre »). Un seul.
- Pas de « voilà, c'était tout » : couper net après le dernier mot utile.
- Si possible, faire boucler : la dernière image ou la dernière phrase ramène à l'accroche.

## 9. Mode animation (sans footage)

- Partir du script : une scène par phrase ou par idée, 2 à 4 s chacune.
- La voix off (enregistrée ou synthétique) fixe les durées ; sans voix, compter 0,35 s par mot affiché.
- Chaque scène a un élément principal et un seul mouvement principal.
- Garder un fond, une palette et une direction de mouvement constants ; changer de fond marque un changement de partie.
- Les règles d'accroche, de sous-titres, de zone sûre et de son s'appliquent à l'identique.

## 10. Vérification avant rendu

Regarder chaque image de `preview` et contrôler :

- [ ] Première image : titre lisible, visage visible, rien de coupé.
- [ ] Premier mot avant 0,3 s.
- [ ] Aucun texte hors zone sûre, aucun texte sur le visage.
- [ ] Sous-titres sans faute, noms propres corrects.
- [ ] Aucun plan identique de plus de 5 s.
- [ ] Chaque overlay est lisible et arrive sur son mot.
- [ ] Aucun chevauchement d'overlays.
- [ ] Coupes : pas de mot tronqué (écouter les jonctions douteuses en rendant 2 s autour).
- [ ] Durée dans la cible.
- [ ] Un seul appel à l'action.

Si un point échoue, corriger l'EDL et relancer `preview`. Ne jamais livrer un rendu qui n'a pas été regardé.

## 11. Ce que le directeur demande à l'utilisateur

Uniquement ce qu'il ne peut pas déduire : l'objectif du Reel (éduquer, vendre, divertir), le public, l'appel à l'action voulu, le brand kit. Tout le reste, il le décide et l'explique en trois lignes dans `edl.notes`.
