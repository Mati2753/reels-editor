import {
  ArrowRight,
  AudioLines,
  Captions,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  ScanLine,
  Scissors,
  Settings2,
  Shapes,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type { Project, Job } from "../model";
import type { Format } from "../formats";
import type { Settings } from "../settings";

interface DirectorProps {
  project: Project;
  settings: Settings;
  format: Format | undefined;
  loading: boolean;
  working: boolean;
  job: Job | null;
  onSettings: (patch: Partial<Settings>) => void;
  onDialog: (which: "settings" | "choose" | "learn" | "decisions") => void;
  onGenerate: () => void;
}
const features = [
  { key: "cuts" as const, icon: Scissors, title: "Smart cuts", hint: "Trim pauses and shape the pace" },
  { key: "captions" as const, icon: Captions, title: "Subtitles", hint: "Time captions to spoken words" },
  { key: "motion" as const, icon: Shapes, title: "Motion & transitions", hint: "Animate titles, zooms and joins" },
  { key: "sound" as const, icon: AudioLines, title: "Sound design", hint: "Mix the voice, music and accents" },
];

export function DirectorPanel({
  project,
  settings,
  format,
  loading,
  working,
  job,
  onSettings,
  onDialog,
  onGenerate,
}: DirectorProps) {
  return (
    <aside className="panel director">
      <div className="director-heading">
        <div className="director-symbol">
          <WandSparkles size={20} />
        </div>
        <div>
          <h2>Edit director</h2>
          <p>{settings.director === "claude" ? "Claude Code" : "Local director"}</p>
        </div>
        <button
          aria-label="Director settings"
          className="icon config"
          disabled={working}
          onClick={() => onDialog("settings")}
        >
          <Settings2 size={17} />
        </button>
      </div>
      <fieldset disabled={working || loading}>
        <legend className="sr-only">Edit direction</legend>
        <div className="section-label">Editing format</div>
        <button className="selected-format" onClick={() => onDialog("choose")}>
          <img src={format?.image ?? "/assets/alpine.jpg"} alt="" />
          <span>
            <strong>{format?.name ?? "Cinematic"}</strong>
            <small>{format?.reference ? "Reference format" : "Studio format"}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <button className="learn-link" onClick={() => onDialog("learn")}>
          <ScanLine size={14} />
          Learn from a reference
          <ChevronRight size={13} />
        </button>
        <div className="section-label options-label">Editing tools</div>
        <div className="features">
          {features.map(({ key, icon: Icon, title, hint }) => (
            <button
              role="switch"
              aria-checked={settings[key]}
              aria-label={title}
              className="feature"
              key={key}
              onClick={() => onSettings({ [key]: !settings[key] })}
            >
              <span className="feature-icon">
                <Icon size={17} />
              </span>
              <span className="feature-copy">
                <strong>{title}</strong>
                <small>{hint}</small>
              </span>
              <span className={`toggle ${settings[key] ? "on" : ""}`}>
                <i />
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="director-footer">
        {working && (
          <div className="job-status" role="status">
            <span>{job?.step ?? "Preparing edit"}</span>
            {job?.progress !== undefined && <b>{job.progress}%</b>}
          </div>
        )}
        <button
          className="primary generate"
          disabled={working || loading || !format}
          onClick={() => {
            onGenerate();
          }}
        >
          {working ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{" "}
          {working ? "Editing…" : project.edit && project.id !== "sample" ? "Regenerate edit" : "Generate edit"}
          {!working && <ArrowRight size={17} />}
        </button>
        {project.edit ? (
          <button className="decision-link" onClick={() => onDialog("decisions")}>
            Review director decisions <ChevronRight size={13} />
          </button>
        ) : (
          <button className="decision-link" disabled={working} onClick={() => onDialog("settings")}>
            Up to {settings.target}s <span>·</span> Director settings <ChevronRight size={12} />
          </button>
        )}
      </div>
    </aside>
  );
}
