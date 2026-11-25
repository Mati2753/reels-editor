import { defaultBrand } from "../src/brand";

import { cachedScene, checkpointScene, hashBytes } from "./storage";
const fps = 30;
const time = (n) => String(Math.round(n * 1000) / 1000);
// Text lives in separate files so punctuation is never interpreted as FFmpeg syntax.
function drawText(core, id, event, kind, width, height, captionStyle) {
  const lines = [""];
  const title = kind !== "caption";
  for (const word of String(event.text).trim().split(/\s+/)) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + word.length + 1 > (title ? 20 : 23)) lines.push(word);
    else lines[last] += (lines[last] ? " " : "") + word;
  }
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const unit = Math.min(width, height) / 720;
  const size = Math.max(12, Math.round(Math.min((title ? 55 : 46) * unit, (width - 0.15 * width) / (longest * 0.72))));
  const file = "text-" + id + ".txt";
  core.FS.writeFile(file, lines.join("\n"));
  const start = time(event.start),
    end = time(event.end);
  const ink = (kind === "number" ? defaultBrand.colors.active : defaultBrand.colors.text).replace("#", "0x");
  const shadow = defaultBrand.colors.outline.replace("#", "0x");
  return (
    "drawtext=fontfile=fonts/caption.ttf:textfile=" +
    file +
    ":expansion=none:fontcolor=" +
    ink +
    ":fontsize=" +
    size +
    ":borderw=3:bordercolor=" +
    shadow +
    "@0.8:shadowx=0:shadowy=2:line_spacing=6:x=(w-text_w)/2" +
    ":y='" +
    (title
      ? "h*0.155+12*exp(-13*(t-" + start + "))"
      : "h*" + (captionStyle?.position === "center" ? 0.52 : 0.71) + "-text_h/2") +
    "'" +
    ":enable='between(t," +
    start +
    "," +
    end +
    ")':alpha='min(1,max(0,(t-" +
    start +
    ")/0.08))*min(1,max(0,(" +
    end +
    "-t)/0.12))'"
  );
}

function captionEvents(words, segment, size) {
  const relevant = words.filter(
    (w) => w.clip === segment.clip && (w.start + w.end) / 2 >= segment.in && (w.start + w.end) / 2 < segment.out,
  );
  const groups = [];
  for (const word of relevant) {
    const previous = groups.at(-1);
    if (
      !previous ||
      previous.words.length >= size ||
      word.start - previous.end > 0.45 ||
      /[.!?]$/.test(previous.words.at(-1))
    ) {
      groups.push({ start: word.start, end: word.end, words: [word.text] });
    } else {
      previous.end = word.end;
      previous.words.push(word.text);
    }
  }
  return groups
    .map((g, i) => ({
      start: Math.max(0, g.start - segment.in),
      end: Math.max(0, Math.min(segment.out, g.end + 0.13, groups[i + 1]?.start ?? Infinity) - segment.in),
      text: g.words.join(" "),
    }))
    .filter((g) => g.end > g.start);
}

export async function render(core, run, edl, facts, sources, getAsset, progress, options) {
  const { width, height } = options.dimensions;
  const byClip = new Map(sources.map((s) => [s.clip, s]));
  const style = options.captionStyle;
  const shotGrade = options.grade;
  const keyBytes = new TextEncoder();
  const list = edl.segments;
  const captions = [],
    scenes = [],
    parts = [];
  if (!core.FS.analyzePath("fonts").exists) core.FS.mkdir("fonts");
  core.FS.writeFile("fonts/caption.ttf", await getAsset(defaultBrand.fonts.caption.file));
  let cursor = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i],
      seconds = s.out - s.in;
    const source = byClip.get(s.clip);
    if (!source) throw Error("A scene refers to missing footage.");
    const frameCount = Math.max(1, Math.round((cursor + seconds) * fps) - Math.round(cursor * fps));
    const transition = edl.transitions.find((t) => t.between[1] === s.id);
    const nextTransition = edl.transitions.find((t) => t.between[0] === s.id);
    const initial = s.framing.scale,
      final = s.framing.move?.toScale ?? initial;
    let z = initial + "+" + (final - initial).toFixed(5) + "*(1-cos(PI*on/" + Math.max(1, frameCount - 1) + "))/2";
    if (transition?.type === "zoom")
      z += "+0.12*max(0,1-on/" + Math.max(1, Math.round(transition.duration * fps)) + ")";
    const filters = [
      "setpts=PTS-STARTPTS",
      "fps=" + fps + ":start_time=0",
      "tpad=stop_mode=clone:stop_duration=0.2",
      "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase:force_divisible_by=2",
      "crop=" + width + ":" + height,
      "setsar=1",
    ];
    if (initial !== 1 || final !== 1 || transition?.type === "zoom")
      filters.push(
        "zoompan=z='" + z + "':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=" + width + "x" + height + ":fps=" + fps,
      );
    if (transition && ["flash", "fade"].includes(transition.type))
      filters.push(
        "fade=t=in:st=0:d=" +
          time(transition.duration / 2) +
          ":color=" +
          (transition.type === "flash" ? "white" : "black"),
      );
    if (nextTransition && ["flash", "fade"].includes(nextTransition.type))
      filters.push(
        "fade=t=out:st=" +
          time(Math.max(0, seconds - nextTransition.duration / 2)) +
          ":d=" +
          time(nextTransition.duration / 2) +
          ":color=" +
          (nextTransition.type === "flash" ? "white" : "black"),
      );
    if (shotGrade.brightness || shotGrade.contrast !== 1 || shotGrade.saturation !== 1)
      filters.push(
        "eq=brightness=" +
          shotGrade.brightness +
          ":contrast=" +
          shotGrade.contrast +
          ":saturation=" +
          shotGrade.saturation,
      );
    const panel = options.broll;
    const showInsert = panel && panel.end > cursor && panel.start < cursor + seconds;
    const page = edl.captions.enabled ? captionEvents(facts.words, s, edl.captions.maxWordsPerPage) : [];
    const opening = edl.overlays.find((o) => o.component === "HookTitle" && o.at.segment === s.id);
    if (opening)
      filters.push(
        drawText(
          core,
          "title",
          { start: 0, end: Math.min(seconds, opening.duration), text: opening.props.text },
          "title",
          width,
          height,
          style,
        ),
      );
    for (const [j, cue] of page.entries())
      filters.push(drawText(core, "caption-" + j, cue, "caption", width, height, style));
    for (const [j, overlay] of edl.overlays.entries()) {
      if (overlay.component !== "BigNumber") continue;
      const word = facts.words.find((w) => w.id === overlay.at.word);
      if (!word || word.clip !== s.clip || word.start < s.in || word.start >= s.out) continue;
      const start = word.start - s.in;
      const { value, decimals, prefix, suffix } = overlay.props;
      filters.push(
        drawText(
          core,
          "number-" + j,
          { start, end: Math.min(seconds, start + overlay.duration), text: prefix + value.toFixed(decimals) + suffix },
          "number",
          width,
          height,
          style,
        ),
      );
    }
    const filename = "scene" + i + ".mp4";
    const firstDraw = filters.findIndex((f) => f.startsWith("drawtext="));
    const pictureFilters = firstDraw < 0 ? filters : filters.slice(0, firstDraw);
    const titles = firstDraw < 0 ? [] : filters.slice(firstDraw);
    const command = ["-ss", time(s.in), "-threads", "1", "-i", source.input];
    if (showInsert) {
      if (!core.FS.analyzePath(panel.file).exists) core.FS.writeFile(panel.file, await getAsset(panel.file));
      command.push("-loop", "1", "-framerate", "30", "-i", panel.file);
      const start = time(Math.max(0, panel.start - cursor)),
        end = time(Math.min(seconds, panel.end - cursor));
      const graph =
        "[0:v]" +
        pictureFilters.join(",") +
        "[base];[1:v]scale=" +
        width +
        ":" +
        height +
        ":force_original_aspect_ratio=increase,crop=" +
        width +
        ":" +
        height +
        ",setsar=1[photo];[base][photo]overlay=enable='between(t," +
        start +
        "," +
        end +
        ")'" +
        (titles.length ? "," + titles.join(",") : "") +
        "[out]";
      command.push("-filter_complex", graph, "-map", "[out]");
    } else command.push("-map", "0:v:0", "-vf", filters.join(","));
    command.push(
      "-an",
      "-threads",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-frames:v",
      String(frameCount),
      filename,
    );
    const sceneKey = await hashBytes(
      keyBytes.encode(
        JSON.stringify([
          "video-v3",
          source.digest,
          s.in,
          s.out,
          command,
          page,
          edl.overlays,
          options.captionStyle,
          showInsert ? panel : null,
        ]),
      ),
    );
    const stored = await cachedScene(sceneKey);
    if (stored) core.FS.writeFile(filename, stored);
    else {
      progress("Rendering scene " + (i + 1) + " of " + list.length, 0.46 + (0.4 * i) / list.length);
      run(command, (t) =>
        progress(
          "Rendering scene " + (i + 1) + " of " + list.length,
          0.46 + (0.4 * (i + Math.min(1, t / seconds))) / list.length,
        ),
      );
      await checkpointScene(sceneKey, core.FS.readFile(filename));
    }
    parts.push("file '" + filename + "'");
    for (const g of page)
      captions.push({
        ...g,
        clip: s.clip,
        sceneId: s.id,
        sourceStart: g.start + s.in,
        sourceEnd: g.end + s.in,
        start: g.start + cursor,
        end: g.end + cursor,
      });
    scenes.push({
      id: s.id,
      clip: s.clip,
      start: cursor,
      end: cursor + seconds,
      source: s.in,
      name: "Scene " + (i + 1),
    });
    cursor += seconds;
  }
  progress("Mixing the sound and finishing your MP4", 0.93);
  core.FS.writeFile("scenes.txt", parts.join("\n") + "\n");
  // Rebuild packet timestamps from the continuous frame count. MP4 concat offsets are rounded to milliseconds.
  run(["-f","concat","-safe","0","-i","scenes.txt","-map","0:v:0","-c:v","copy","-bsf:v","h264_mp4toannexb","-f","h264","joined.h264"]);
  const inputs=["-framerate",String(fps),"-f","h264","-i","joined.h264"];
  const filters = [];
  let next = 1;
  const audioInputs = new Map();
  for (const source of sources) {
    if (!source.audio || !list.some((s) => s.clip === source.clip)) continue;
    inputs.push("-i", source.input);
    audioInputs.set(source.clip, next++);
  }
  list.forEach((s, i) => {
    const id = audioInputs.get(s.clip),
      len = time(s.out - s.in);
    const src =
      id === undefined
        ? "anullsrc=r=44100:cl=stereo,atrim=duration=" + len
        : "[" + id + ":a:0]atrim=start=" + time(s.in) + ":end=" + time(s.out);
    filters.push(
      src +
        ",asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=" +
        len +
        ",atrim=duration=" +
        len +
        "[a" +
        i +
        "]",
    );
  });
  filters.push(list.map((_, i) => "[a" + i + "]").join("") + "concat=n=" + list.length + ":v=0:a=1[voice]");
  const mix = [];
  const tracks = new Map();
  const addInput = async (file, loop = false) => {
    if (tracks.has(file)) return tracks.get(file);
    const name = file.split("/").at(-1);
    core.FS.writeFile(name, await getAsset(name));
    if (loop) inputs.push("-stream_loop", "-1");
    inputs.push("-i", name);
    tracks.set(file, next);
    return next++;
  };
  const music = edl.audio.music;
  if (music) {
    const id = await addInput(music.file, true);
    filters.push("[voice]asplit=2[direct][key]");
    filters.push(
      "[" +
        id +
        ":a]atrim=duration=" +
        time(cursor) +
        ",volume=" +
        music.gainDb +
        "dB,afade=t=out:st=" +
        time(Math.max(0, cursor - 0.8)) +
        ":d=0.8[bed]",
    );
    filters.push("[bed][key]sidechaincompress=threshold=0.04:ratio=4:attack=25:release=310[ducked]");
    mix.push("[direct]", "[ducked]");
  } else mix.push("[voice]");
  for (const [i, sound] of edl.audio.sfx.entries()) {
    const id = await addInput(sound.file);
    const idx = list.findIndex((s) => s.id === sound.at.segment);
    const delay = Math.round(1000 * (scenes[idx]?.start ?? 0));
    filters.push("[" + id + ":a]volume=" + sound.gainDb + "dB,adelay=" + delay + ":all=1[fx" + i + "]");
    mix.push("[fx" + i + "]");
  }
  filters.push(
    mix.join("") +
      "amix=inputs=" +
      mix.length +
      ":duration=first:normalize=0,volume=" +
      options.gainDb +
      "dB,alimiter=limit=0.97[mix]",
  );
  run([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[mix]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-t",
    time(cursor),
    "-movflags",
    "+faststart",
    "reel.mp4",
  ]);
  return { bytes: core.FS.readFile("reel.mp4"), seconds: cursor, scenes, captions };
}
