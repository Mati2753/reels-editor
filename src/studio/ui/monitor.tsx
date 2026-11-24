import { useEffect, useRef, useState } from "react";
import {
  Captions,
  ChevronDown,
  Clapperboard,
  Film,
  Maximize,
  Music2,
  Pause,
  Play,
  Scan,
  SkipBack,
  Volume2,
  VolumeX,
} from "lucide-react";
import { sample, type Project } from "../model";

export function timecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const media = (p: Project, name: string) =>
  p.id === sample.id ? "/assets/" + (name === "source.mp4" ? sample.filename : name) : `/media/${p.id}/${name}`;

export function Monitor({
  project,
  output,
  onOutput,
}: {
  project: Project;
  output: boolean;
  onOutput: (v: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const cut = output ? project.edit : undefined;
  const src = media(project, cut ? cut.id + ".mp4" : "source.mp4");
  const length = cut?.seconds ?? project.seconds;
  const seek = (t: number) => {
    if (video.current) {
      video.current.currentTime = Math.max(0, Math.min(length, t));
      setAt(video.current.currentTime);
    }
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlayerError("Could not play this video in this browser."));
    else v.pause();
  };
  useEffect(() => {
    setAt(0);
    setPlaying(false);
    setPlayerError("");
  }, [src]);
  const segments = cut?.segments ?? [{ start: 0, end: length, name: project.filename, source: 0 }];
  return (
    <>
      <section className="panel monitor" aria-label="Video preview">
        <div className="panel-head">
          <h2>
            <Scan size={16} />
            Preview monitor
          </h2>
          <div className="monitor-source">
            {project.edit ? (
              <label className="mini-select">
                <select
                  aria-label="Preview version"
                  value={output ? "cut" : "source"}
                  onChange={(e) => onOutput(e.target.value === "cut")}
                >
                  <option value="cut">Director’s cut</option>
                  <option value="source">Source footage</option>
                </select>
                <ChevronDown size={12} />
              </label>
            ) : (
              <span className="tiny-tag">Source footage</span>
            )}
          </div>
        </div>
        <div className="stage" ref={screen}>
          <div className="frame">
            <video
              key={src}
              ref={video}
              src={src}
              preload="metadata"
              playsInline
              muted={muted}
              poster={
                cut ? (project.id === "sample" ? "/assets/sample-cover.jpg" : undefined) : media(project, "poster.jpg")
              }
              onClick={toggle}
              onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setPlayerError("This preview could not be loaded.")}
            />
            <b className="corner tl" />
            <b className="corner tr" />
            <b className="corner bl" />
            <b className="corner br" />
          </div>
          <span className="stage-ratio">{cut ? "9:16" : ""}</span>
          {playerError && (
            <p className="player-error" role="alert">
              {playerError}
            </p>
          )}
        </div>
        <div className="transport">
          <button className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button className="icon rewind" onClick={() => seek(0)} aria-label="Back to start">
            <SkipBack size={15} />
          </button>
          <span className="clock">
            {timecode(at)} <b>/</b> <em>{timecode(length)}</em>
          </span>
          <input
            className="seek"
            type="range"
            min={0}
            max={length}
            step={0.01}
            value={Math.min(at, length)}
            aria-label="Seek video"
            onChange={(e) => seek(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, var(--accent) ${(at / length) * 100}%, #454747 ${(at / length) * 100}%)`,
            }}
          />
          <button className="icon" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            className="icon"
            aria-label="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void screen.current?.requestFullscreen().catch(() => undefined);
            }}
          >
            <Maximize size={15} />
          </button>
        </div>
      </section>
      <section className="panel sequence">
        <div className="panel-head">
          <h2>
            <Clapperboard size={16} />
            Timeline
          </h2>
          <span className="sequence-meta">
            {cut ? `${segments.length} shots` : "Original sequence"} <span>·</span> {length.toFixed(1)}s
          </span>
        </div>
        <div className="timeline-content">
          <div className="track-labels">
            <div className="ruler-space" />
            <div>
              <Film size={14} />
              Picture
            </div>
            <div>
              <Music2 size={14} />
              Audio
            </div>
            {cut?.captions.length ? (
              <div>
                <Captions size={14} />
                Text
              </div>
            ) : null}
          </div>
          <div className="tracks">
            <div className="ruler">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <span key={n}>{timecode(n * length)}</span>
              ))}
            </div>
            <div className="film-track">
              {segments.map((s, i) => (
                <button
                  key={i}
                  title={`${s.name} · ${s.start.toFixed(1)}s`}
                  aria-label={`Seek to ${s.name}`}
                  onClick={() => seek(s.start)}
                  style={{
                    width: `${((s.end - s.start) / length) * 100}%`,
                    backgroundImage: `linear-gradient(90deg,#1118,transparent),url(${media(project, "strip.jpg")})`,
                    backgroundSize: cut
                      ? `auto, ${Math.max(100, (project.seconds / (s.end - s.start)) * 100)}% 100%`
                      : "auto,100% 100%",
                    backgroundPosition: `center, ${(s.source / Math.max(0.01, project.seconds - (s.end - s.start))) * 100}% center`,
                  }}
                >
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
            <div className="audio-track">
              {project.hasAudio || (cut && (cut.music || cut.sounds.length)) ? (
                <img alt="Audio waveform" src={media(project, cut ? cut.id + ".png" : "wave.png")} />
              ) : (
                <span>Silent source</span>
              )}
            </div>
            {cut?.captions.length ? (
              <div className="caption-track">
                {cut.captions.map((c, i) => (
                  <button
                    key={i}
                    title={c.text}
                    onClick={() => seek(c.start)}
                    style={{ left: `${(c.start / length) * 100}%`, width: `${((c.end - c.start) / length) * 100}%` }}
                  >
                    {c.text}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="playhead" style={{ left: `${Math.min(100, (at / length) * 100)}%` }} />
          </div>
        </div>
      </section>
    </>
  );
}
