# Cutroom editing studio

Cutroom is a local web editor for vertical reels. The interface, footage analysis, speech recognition and render workers run on the computer that starts the editor. Projects and learned formats live under the repository’s ignored `projects/` directory.

## Start the editor

Install Node 22.12 or later and FFmpeg with ffprobe. From the repository root run

```sh
npm ci
npm run editor
```

Open http://localhost:4173. The included **Alpine field notes** project opens with a playable director’s cut. Switch the preview to **Source footage** to compare the original 12 seconds with the 8.6-second edit. The example includes a reviewed transcript and works without a speech model.

For automatic subtitles on your own footage, install the Python dependencies once

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

On Windows use `.venv\Scripts\python.exe -m pip install -r requirements.txt`. The studio downloads the multilingual `base` Whisper model the first time it transcribes. `REELS_WHISPER_MODEL` accepts a model name or a local model directory. `REELS_PYTHON` selects a particular interpreter. Alternatively, attach an SRT file in **Director settings**. Cue timings are preserved and word timings are interpolated within each cue.

Remotion downloads a headless browser on its first render. `REELS_BROWSER_EXECUTABLE` can point to an installed Chromium executable. `PORT` changes the listening port. The server binds to loopback by default.

## Edit footage

1. **Import footage** opens a new project. Choose a video at least five seconds long and up to 512 MB. Cutroom builds a browser-compatible preview and an audio waveform.
2. Pick an **Editing format**, or choose **Learn from a reference** and name a new format.
3. Set **Smart cuts**, **Subtitles**, **Motion & transitions**, and **Sound design**. **Director settings** also lets you choose a maximum length of 15, 30, 60 or 90 seconds.
4. **Generate edit** analyzes the source, validates the edit decision list (EDL), and renders a 1080 × 1920 H.264/AAC MP4 at 30 fps. You can leave the project and return via **Projects** during a render.
5. Play the director’s cut, scrub its picture and subtitle tracks, or compare it with the source. **Review director decisions** explains the selections and downloads the EDL. **Export reel** downloads the finished video. Changing the settings takes effect on the next generation. A previous successful cut stays available during a retry.

## What a reference teaches

Each reference is decoded independently from the footage being edited. Cutroom measures shot boundaries, median shot duration, brief flashes, inter-frame luminance change, audio loudness and time spent in silence. If the reference contains a supported embedded text subtitle track, it also measures the typical words per cue.

The saved format uses these signals to set cut cadence, pause tolerance, zoom strength, transition preference, caption grouping and music level. Motion and sound settings are editorial estimates. Matching burned-in text, exact fonts, camera paths or a particular recording requires manual direction. The library keeps the measurements, settings and a thumbnail. The reference upload is discarded after analysis.

Select a saved format in **Formats** or in the project’s format picker. Importing new footage carries the selected settings into the new project.

## Local and Claude Code direction

The local director identifies shot and sentence boundaries, removes long pauses and abandoned takes when speech timings are available, and chooses material within the duration limit. It anchors overlays and audio cues to the source words and segments in the EDL. It uses the renderer and validator already shared by the original Claude Code workflow.

Select **Claude Code** in **Director settings** to use a signed-in Claude CLI on the server computer. Check `claude auth status` first. `REELS_CLAUDE` can point to a specific executable. You can provide a brief such as “Open with the result and then explain how we got there.” Cutroom sends the candidate beat IDs, transcript excerpts, durations, format and brief to Claude. The request runs with built-in tools disabled. Only validated beat IDs, a short title and a reason come back into the editor. If the session fails, Cutroom shows the error and keeps the previous export.

For a hands-on collaboration in Claude Code, run `/review-edit <project-slug>` from the repository. The studio keeps the successful `edl.json`, normalized footage and analysis in the same layout used by the existing CLI. A manual variation can be validated, previewed and rendered using `--edl` without replacing the studio cut.

## Files

| Location | Contents |
| --- | --- |
| `projects/<slug>/raw/` | Uploaded source |
| `projects/<slug>/work/` | Normalized media, transcript, analysis, key frames and render cache |
| `projects/<slug>/edl.json` | Latest successful studio EDL |
| `projects/<slug>/work/edits/` | Versioned edit decision lists |
| `projects/<slug>/out/` | Finished MP4s and their waveforms |
| `projects/.formats/<id>/` | Learned format and thumbnail |
