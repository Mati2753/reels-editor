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

Exemple complet, écrit à la main sur le footage synthétique : `examples/demo/edl.json` (ses `notes` expliquent chaque choix).

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
- Repère : quand `analysis.json` relie le mot retiré au mot gardé par un `sound` non isolé, il n'y a pas de silence entre eux. La coupe garde alors quelques centièmes de seconde de la fin du mot retiré (mesuré sur le footage synthétique : 20 à 30 ms à environ 10 dB sous la voix) ou mange l'attaque du suivant. Écouter cette jonction avant de livrer.

**Durée cible :** 20 à 45 s pour un conseil, jusqu'à 60–90 s pour une histoire. Si le premier montage dépasse, couper du contenu plutôt qu'accélérer.

## 3. Cadrage et zooms

Chaque coupe dans un plan fixe produit un saut visible. On le rend intentionnel en changeant d'échelle.

- Alterner les échelles entre segments consécutifs : 1,0 → 1,15 → 1,0 → 1,25. Écart minimum de 0,12, sinon le saut ressemble à une erreur.
- Centrer le zoom sur les yeux (`origin` légèrement au-dessus du centre du visage).
- **Punch-in sec** (changement d'échelle à la coupe) : sur une affirmation forte, un chiffre, une chute.
- **Zoom lent** (`move`, +4 à +8 % sur le segment) : sur une explication, une montée de tension.
- **Retour au plan large** : au début d'une nouvelle idée.
- Échelle maximale 1,4 sur une source 1080p, 1,8 sur une source 4K. Au-delà l'image est floue.
- Le cadre ne sort jamais de l'image source : près d'un bord, le recadrage s'arrête au bord et `validate` prévient (`framing-shifted`). Sur une source verticale, un cadrage d'échelle s ne se centre qu'entre 1/(2s) et 1 − 1/(2s) de la hauteur : à 1,15 entre 0,435 et 0,565, à 1,25 entre 0,4 et 0,6. Des yeux plus hauts ne peuvent pas être au centre exact ; le cadre s'en approche autant que possible. Une source horizontale est recadrée en 9:16 autour de `origin.x` dès l'échelle 1.

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

- Une transition ne change ni la durée ni la synchro : sa fenêtre est centrée sur la coupe, la voix reste coupée net, et chaque image est prolongée par sa propre source de part et d'autre (voir `EDL.md`). Regarder à l'aperçu les images de début et de fin de fenêtre : elles montrent quelques images juste avant l'`in` ou juste après l'`out`.
- `slide` et `whip` prennent une `direction` (vers où l'image part, `left` par défaut) ; garder la même dans tout le Reel.
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

**Catalogue.** Ce qui existe réellement dans `src/remotion/overlays/` (`index.ts` est le registre ; `validate` vérifie les props avec le schéma de chaque fichier). Toutes les couleurs, polices et marges viennent du brand kit. Entre parenthèses après une prop : le nombre de caractères maximal accepté par le schéma. Dans cette limite, le texte est composé avec la police réelle dans sa zone (taille réduite, puis retour à la ligne) ; `validate` dit s'il a été réduit (`overlay-text-shrunk`) ou s'il ne tient pas (`overlay-text-overflow`, `overlay-zone-overflow`). Les zones possibles sont celles du composant (`overlay-zone`). Mouvement par défaut entre parenthèses (entrée / sortie, en images à 30 fps) ; `enter` et `exit` le remplacent. La galerie du Studio (`npm run studio`, dossier « Gallery ») et `npm run gallery` (planches-contacts dans `out/gallery/`) montrent chacun d'eux.

| Composant | Props (longueur max) | Zones | Cues | Quand l'utiliser |
|---|---|---|---|---|
| `HookTitle` | `text` (60, viser 3 à 7 mots), `highlight` : mots de `text` en couleur d'accent (4 au plus), `kicker` : étiquette au-dessus (24) | top, center | – | L'accroche, dès la première image. Lignes en capitales sur des bandeaux sombres, mots clés soulignés. (scale 10 / fade 5) |
| `KeywordPop` | `text` (28, 1 à 3 mots), `tone` : `accent` \| `active` \| `light`, `tilt` : −8 à 8° (−3) | top, center | – | Un mot-clé, un concept à retenir, au moment où il est dit. Bloc incliné qui surgit. (pop 10 / scale 5) |
| `BigNumber` | `value` (nombre), `decimals` 0–2, `prefix` (3), `suffix` (4 : « % », « € », « k »), `label` (40), `countFrom` (0 ; = `value` pour ne pas compter) | top, center, full | – | Un chiffre, un prix, un pourcentage. Compteur qui monte en 0,8 s, unité en accent, libellé dessous. (pop 10 / scale 5) |
| `ListReveal` | `title` (30), `items` : 2 à 5 textes (40 chacun), `numbered` (oui) | top, center, full | un par item | Une liste annoncée (« trois erreurs »). Chaque item sur le mot qui le nomme ; le dernier apparu est en blanc, les précédents s'estompent. En `top`, 3 items courts au plus. (slide depuis la gauche 10 / fade 5) |
| `CtaCard` | `title` (28, impératif), `subtitle` (44), `action` : `follow` \| `save` \| `comment` \| `share` \| `like` \| `link`, `handle` (24, « @compte ») | bottom, center, full | – | L'appel à l'action final, un seul. Carte claire, bouton d'accent qui « tape » une fois posé. En `full`, carte de fin centrée. (slide depuis le bas 11 / slide vers le bas 6) |
| `SectionTitle` | `index` (3 : « 02 »), `title` (36), `subtitle` (48) | full, center | – | Le début d'une nouvelle partie, 1,5 à 2 s plein écran, puis retour au visage. (scale 10 / fade 5) |
| `LabelTag` | `name` (30), `detail` (40), `icon` : `none` \| `person` \| `pin` \| `tool` \| `brand` \| `link` \| `star` | top, center, bottom | – | Un nom, une marque, un lieu, un outil quand il est cité. Étiquette alignée sur la marge gauche, qui se déplie depuis sa barre d'accent. (slide depuis la gauche 10 / slide vers la gauche 5) |
| `SplitCompare` | `left`, `right` : `{ label (16), text (40) }`, `winner` : `left` \| `right` (défaut) \| `none`, `badge` (3, « VS ») | full, center | 2 : gauche, droite | Une comparaison, un avant / après. Le perdant en retrait avec une croix, le gagnant bordé d'accent avec une coche. Chaque côté sur son mot. (fade 6 / fade 5) |
| `StepFlow` | `title` (30), `steps` : 2 à 4 textes (32 chacun) | full, center | une par étape | Un processus, une méthode en étapes. Pastilles numérotées reliées par un trait qui se dessine d'une étape à l'autre. (fade 6 / fade 5) |
| `QuoteCard` | `quote` (90, viser 12 mots au plus), `author` (30), `detail` (36) | center, full | – | Une citation, un avis client, un commentaire lu à voix haute. Carte claire, guillemet d'accent, initiales de l'auteur. Le texte dépasse souvent 6 mots : `overlay-word-count` avertit, garder la citation courte. (scale 10 / scale 5) |
| `ChatBubble` | `name` (24), `messages` : 1 à 3 `{ text (60), from : them \| me }` | center, top, full | une par message | Une question reçue, un échange de messages. Bulles claires à gauche (l'autre), d'accent à droite (soi), chacune sur son mot. En `top`, 2 messages au plus. (fade 5 / fade 5) |
| `ChartGrow` | `title` (30), `bars` : 2 à 6 `{ label (10), value ≥ 0 }`, `unit` (3), `decimals` 0–1, `highlight` (index, dernière barre par défaut) | full, center | une par barre (sinon échelonnées) | Une évolution, des chiffres à comparer. Barres qui poussent depuis la ligne de base, valeurs comptées, la barre qui compte en accent. En `center`, 4 barres au plus. (fade 6 / fade 5) |
| `LogoCard` | `name` (24), `initials` (3, sinon tirées du nom), `tagline` (36), `shape` : `rounded` \| `circle` | top, center | – | Une marque, un outil, une application. Monogramme sur tuile d'accent qui pivote ; les logos en image arrivent avec le b-roll (phase 7). (scale 10 / scale 5) |
| `ScreenMock` | `device` : `phone` \| `browser`, `url` (28), `title` (40), `lines` : 0 à 3 (40), `button` (18) | full | – | Un site, une app, un écran, à défaut d'enregistrement d'écran : appareil dessiné qui se redresse, page qui défile doucement. (slide depuis le bas 12 / fade 6) |

Tout nouveau composant est ajouté à ce catalogue dans le même commit que son fichier.

**Synchronisation :**
- L'overlay s'ancre sur le mot qui le justifie et entre 2 à 4 images avant (`offset: -0.1`). L'œil doit voir l'élément au moment où l'oreille entend le mot. L'ancre est la première image visible.
- Dans une liste, chaque item apparaît sur son propre mot, pas tous ensemble : un `cue` par item, ancré comme l'overlay (`offset: -0.1`).
- Durée : assez pour être lu deux fois. Compter 0,3 s par mot affiché, minimum 1,2 s, maximum 4 s.
- Sortie avant la phrase suivante, ou sur une coupe.

**Dosage :**
- Une seule idée à l'écran à la fois. Jamais deux overlays chargés simultanément.
- Zones : `top` au-dessus du visage, `center` sur le buste (rarement : il cache le corps), `bottom` au-dessus de la légende d'Instagram (les sous-titres `auto` remontent alors au centre), `full` remplace l'image (fond du brand kit) et laisse le tiers inférieur aux sous-titres. Couche par défaut : `front` ; `behind-captions` quand un sous-titre doit pouvoir passer devant ; `background` pour un plein écran sous les autres overlays.
- Un plein écran chargé en texte (`SplitCompare`, `StepFlow`, `ChartGrow`, `ListReveal` en `full`) se lit mieux sans sous-titres : `captions.hide` sur sa durée ; il peut alors descendre jusqu'à la zone sûre basse.
- 6 mots maximum par overlay, sous-titres exclus.
- Plein écran : 1,5 à 4 s, puis retour au visage. Le visage reste à l'écran au moins 50 % du Reel en mode face caméra : c'est lui qui crée la confiance.
- Une phrase d'émotion ou de conviction se joue sur le visage, sans rien par-dessus.

**Mouvement :**
- Entrées rapides avec amorti (ressort, 8 à 12 images). Sorties plus rapides que les entrées (4 à 6 images). Les valeurs par défaut des composants le font déjà ; ne les changer que pour une raison.
- Les éléments viennent d'une direction cohérente dans tout le Reel (`enter.direction` des `slide`).
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
- Le découpage en pages et en lignes est fait par `resolve` à partir des mots gardés (règles dans `docs/EDL.md`, « Sous-titres ») ; le directeur choisit le nombre de mots par page, la position, l'emphase et les corrections. Une correction à `""` retire un mot des sous-titres sans toucher au son. Style disponible : `bold` (police du brand kit en capitales, contour, mot actif dans la couleur `active` du brand kit et un peu plus grand, ponctuation finale retirée sauf « ? » et « ! »).

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

## Direction automatique du studio

Le format appris conserve la cadence mesurée des plans, le mouvement entre images, les flashes, le niveau audio et les groupes de mots des sous-titres intégrés. La direction utilise ces faits pour régler le rythme, les zooms, les transitions, les pages de sous-titres et le mix. Un titre ouvre le montage. Les chiffres parlés peuvent déclencher un `BigNumber` ancré au mot. Les coupes respectent les mots et privilégient les groupes de phrases quand la durée impose une sélection. Les raisons du montage se trouvent dans `edl.notes` et dans le panneau de décisions du studio. Les mesures et limites sont décrites dans `docs/STUDIO.md`.

### Reference-driven browser direction

The browser keeps source frame measurements and reference-relative cut candidates. A visual change or spoken emphasis can justify movement. Silence, source changes and supported changes of scene guide joins and accents. A measured reference takes precedence over the built-in preset. A licensed illustration requires matching words in retained speech. The portable cut records its source and reason. Unknown narrative intent remains available for human review.

For references with at least six shots, compare the opening, middle and closing thirds with each reference’s typical shot length. Apply the observed ratios within 0.65–1.5 of the template pace. Speech boundaries still constrain individual cuts.

English OCR samples six reference frames. Two different high-confidence lines in the same centered band across distinct times can guide subtitle placement, apparent size and grouping. A static logo alone supplies no caption rule. Three evenly distributed authored cues are sampled after rendering. A failed reading or low local contrast can trigger a backplate on the affected cue within the selected iteration limit.

A viewer can give feedback from a rendered cut. Retrieve it for subsequent projects sharing a template family and speech presence. A still camera request removes programmed zooms and zoom transitions. A rejected illustration cannot be selected again within that scope.

A browser edit can follow a single clearly detected frontal face. Within each retained scene, apply only a track with adequate temporal coverage and without competing strong detections or large jumps. Use the median single-face position from saved references as the composition target. Fall back to centered cropping when evidence is weak. Screen tracking takes precedence when the user requests backdrop replacement and the screen detector accepts the source.

When captioned speech states one exact percentage of a whole, a generated bar may illustrate the quantity if no stock match was selected. Skip ambiguous, negative, comparative and out-of-range quantities. Global image scale fitting across reference shots can guide a pullback. Exclude hard cuts and pairs with too little improvement across the image.

### Protéger le son du tournage

Le directeur conserve la musique déjà présente lorsque les observations couvrent suffisamment les séquences retenues. Après le rendu, il compare la parole dans chaque plan avec les mêmes instants du rush. Une baisse persistante de la parole accompagnée d'une hausse de la musique justifie une atténuation localisée de la musique et des effets ajoutés. Le rapport conserve les passages encore problématiques. Un mix explicitement approuvé peut être repris pour la même famille de style et le même contexte de parole. [Mesures et exemples](AUDIO-DIRECTION.md)

Le directeur peut insérer une vidéo de coupe lorsque la phrase identifie clairement son sujet. L’extrait du Solar Dynamics Observatory illustre les mentions littérales d’une éruption solaire. Le son du rush reste la source narrative. Le fichier de montage conserve la justification, le crédit et le lien de provenance. Une texture ou un effet de brillance du catalogue natif reste un choix explicite. [Exemples de rendu](PRODUCTION-ASSETS.md)
