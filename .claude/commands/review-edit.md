---
description: Review an existing Cutroom edit and produce a separate variation
argument-hint: <project-slug> [editorial brief]
---

Review the existing studio project named in $ARGUMENTS using the repository’s director instructions.

1. Identify the project under `projects/`. Read `studio.json`, `edl.json`, `work/analysis.json`, the source key frames, `docs/DIRECTOR.md` and `docs/EDL.md`. Look up the cut’s selected format in `projects/.formats/` if it was learned from a reference.
2. Explain which cuts, sentence boundaries, visible transitions and sound cues you would keep or change. Use the supplied brief if present.
3. Write the revised EDL as `projects/<slug>/claude-review.edl.json`. Preserve the studio’s current EDL and export.
4. Run `npm run reels -- validate <slug> --edl projects/<slug>/claude-review.edl.json`, then `preview` with the same arguments. Inspect the rendered frames and correct any problems before running `render` with the same arguments.
5. Return the variation’s MP4 path, duration, and the editorial reasons for the changes.
