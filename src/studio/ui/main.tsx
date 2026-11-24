import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  FolderOpen,
  Layers2,
  MonitorPlay,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { defaultSettings as defaults, SettingsSchema, type Settings } from "../settings";
import type { Format } from "../formats";
import { sample, type Project, type Job } from "../model";
import { FileDialog, Modal } from "./dialog";
import { Monitor, media } from "./monitor";
import { WorkspaceLibrary, type Library } from "./library";
import { DirectorPanel } from "./director-panel";

type Page = "Studio" | "Projects" | "Formats";
type Dialog = "upload" | "learn" | "choose" | "settings" | "decisions" | null;
const nav = [
  { name: "Studio" as const, icon: MonitorPlay },
  { name: "Projects" as const, icon: FolderOpen },
  { name: "Formats" as const, icon: Layers2 },
];
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.method ? { "X-Cutroom": "studio" } : {}), ...init.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The workspace could not complete the request.");
  return data as T;
}

function App() {
  const [page, setPage] = useState<Page>("Studio");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [library, setLibrary] = useState<Library>({ example: sample, formats: [], projects: [] });
  const [project, setProject] = useState<Project>(sample);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [job, setJob] = useState<Job | null>(null);
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const current = useRef(sample.id);
  const srt = useRef<HTMLInputElement>(null);
  const format = library.formats.find((f) => f.id === settings.format);
  const working = job?.state === "working" || pending;
  const draftKey = (id: string) => "cutroom.draft.v1." + id;
  function update(patch: Partial<Settings>) {
    const updated = { ...settings, ...patch };
    localStorage.setItem(draftKey(current.current), JSON.stringify(updated));
    setSettings(updated);
  }

  function open(p: Project, initial?: Settings) {
    current.current = p.id;
    let saved: Settings | undefined;
    try {
      const draft = localStorage.getItem(draftKey(p.id));
      if (draft) saved = SettingsSchema.parse(JSON.parse(draft));
    } catch {
      /* An old or incomplete browser draft can be rebuilt from the saved edit. */
    }
    if (initial) localStorage.setItem(draftKey(p.id), JSON.stringify(initial));
    setProject(p);
    setJob(null);
    setSettings(initial ?? saved ?? p.edit?.settings ?? defaults);
    setOutput(true);
    setError("");
    setNotice("");
    setDialog(null);
    setPage("Studio");
    localStorage.setItem("cutroom.project", p.id);
  }
  function remember(p: Project) {
    setLibrary((l) => ({ ...l, projects: [p, ...l.projects.filter((x) => x.id !== p.id)] }));
  }
  useEffect(() => {
    api<Library>("/api/library")
      .then((l) => {
        setLibrary(l);
        const p = l.projects.find((p) => p.id === localStorage.getItem("cutroom.project"));
        open(p ?? l.example);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (project.id === "sample") return;
    let live = true;
    let timer: number;
    const poll = async () => {
      try {
        const data = await api<{ project: Project; job: Job | null }>(`/api/projects/${project.id}`);
        if (!live) return;
        setJob(data.job);
        if (data.project.edit?.id !== project.edit?.id) {
          setProject(data.project);
          remember(data.project);
          setOutput(true);
          setNotice("Your director’s cut is ready.");
        }
      } catch (e) {
        if (live) setError(message(e));
      }
      if (live) timer = window.setTimeout(poll, 1400);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [project.id, project.edit?.id]);

  function message(e: unknown) {
    return e instanceof Error ? e.message : "The request failed.";
  }
  async function realProject() {
    if (project.id !== "sample") return project;
    const p = await api<Project>("/api/sample", { method: "POST" });
    localStorage.setItem(draftKey(p.id), JSON.stringify(settings));
    current.current = p.id;
    setProject(p);
    remember(p);
    localStorage.setItem("cutroom.project", p.id);
    return p;
  }
  async function generate() {
    if (working) return;
    setPending(true);
    setNotice("");
    setError("");
    try {
      const p = await realProject();
      const result = await api<{ job: Job }>(`/api/projects/${p.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (current.current === p.id) setJob(result.job);
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  async function submit(file: File, label: string) {
    const headers = {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
      "X-Format-Name": encodeURIComponent(label),
    };
    if (dialog === "learn") {
      const f = await api<Format>("/api/formats", { method: "POST", headers, body: file });
      setLibrary((l) => ({ ...l, formats: [...l.formats, f] }));
      update({ format: f.id });
      setDialog(null);
      setNotice(`“${f.name}” is saved and selected.`);
    } else {
      const p = await api<Project>("/api/projects", { method: "POST", headers, body: file });
      remember(p);
      open(p, settings);
    }
  }
  async function attachSrt(file?: File) {
    if (!file) return;
    setError("");
    setPending(true);
    try {
      const p = await realProject();
      const updated = await api<Project>(`/api/projects/${p.id}/subtitles`, {
        method: "POST",
        headers: { "X-Filename": encodeURIComponent(file.name) },
        body: file,
      });
      setProject(updated);
      remember(updated);
      update({ captions: true });
      setNotice("Subtitle timing attached.");
      setDialog(null);
    } catch (e) {
      setDialog(null);
      setError(message(e));
    } finally {
      setPending(false);
      if (srt.current) srt.current.value = "";
    }
  }
  function useFormat(f: Format) {
    update({ format: f.id });
    setDialog(null);
    setPage("Studio");
    setNotice(`“${f.name}” selected.`);
  }
  const err = error || (job?.state === "failed" ? job.step : "");
  const [dismissed, setDismissed] = useState("");
  const showError = err && err !== dismissed;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Cutroom<span className="brand-dot">.</span>
        </div>
        <nav aria-label="Workspace">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? "selected" : ""}
              onClick={() => {
                setPage(name);
                setNotice("");
              }}
            >
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        <div className="local">
          <i />
          Local workspace
        </div>
      </header>
      <main>
        {(showError || notice) && (
          <div className={`banner ${showError ? "bad" : ""}`} role={showError ? "alert" : "status"}>
            {showError ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{showError ? err : notice}</span>
            <button
              className="icon"
              aria-label="Dismiss message"
              onClick={() => {
                setDismissed(err);
                setError("");
                setNotice("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {page === "Studio" ? (
          <>
            <div className="project-heading">
              <div>
                <div className="crumb">
                  <span className="studio-mark" />
                  <button onClick={() => setPage("Projects")}>Workspace</button>
                  <ChevronRight size={12} />
                  Editing studio
                </div>
                <div className="title-row">
                  <h1>{project.title}</h1>
                  {project.id === "sample" && <span className="sample-badge">Sample project</span>}
                </div>
                <div className="project-meta">
                  <span>
                    <Clapperboard size={13} />
                    Vertical reel
                  </span>
                  <i />
                  1080 × 1920
                  <i />
                  30 fps
                </div>
              </div>
              <div className="header-actions">
                <button className="secondary" onClick={() => setDialog("upload")}>
                  <Upload size={16} />
                  Import footage
                </button>
                {project.edit ? (
                  <a className="primary" href={media(project, project.edit.id + ".mp4") + "?download=1"} download>
                    <ArrowDownToLine size={16} />
                    Export reel
                  </a>
                ) : (
                  <button className="export-idle" disabled title="Generate an edit to export an MP4">
                    <ArrowDownToLine size={16} />
                    Export reel
                  </button>
                )}
              </div>
            </div>
            <div className="workspace-grid">
              <div className="left-col">
                <Monitor project={project} output={output} onOutput={setOutput} />
              </div>
              <DirectorPanel
                project={project}
                settings={settings}
                format={format}
                loading={loading}
                working={working}
                job={job}
                onSettings={update}
                onDialog={setDialog}
                onGenerate={() => {
                  setDismissed("");
                  void generate();
                }}
              />
            </div>
          </>
        ) : (
          <>
            <WorkspaceLibrary
              page={page}
              library={library}
              onCreate={() => setDialog(page === "Projects" ? "upload" : "learn")}
              onProject={open}
              onFormat={useFormat}
            />
          </>
        )}
      </main>
      {(dialog === "upload" || dialog === "learn") && (
        <FileDialog key={dialog} reference={dialog === "learn"} close={() => setDialog(null)} submit={submit} />
      )}
      {dialog === "choose" && (
        <Modal title="Choose an editing format" close={() => setDialog(null)}>
          <div className="format-list">
            {library.formats.map((f) => (
              <button className={settings.format === f.id ? "chosen" : ""} key={f.id} onClick={() => useFormat(f)}>
                <img src={f.image} alt="" />
                <span>
                  <strong>{f.name}</strong>
                  <small>{f.description}</small>
                </span>
                {settings.format === f.id ? <Check size={16} /> : <ChevronRight size={15} />}
              </button>
            ))}
          </div>
          <button className="secondary wide" onClick={() => setDialog("learn")}>
            <ScanLine size={16} />
            Learn from a reference
          </button>
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal title="Director settings" close={() => setDialog(null)} locked={pending}>
          <label className="field-label">
            Director
            <select
              value={settings.director}
              onChange={(e) => update({ director: e.target.value as Settings["director"] })}
            >
              <option value="local">Local director</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          {settings.director === "claude" && (
            <>
              <p>
                Uses your signed-in Claude Code CLI. Beat timings, transcript excerpts and the brief are sent to Claude.
              </p>
              <label className="field-label">
                Director brief
                <textarea
                  maxLength={500}
                  placeholder="Open with the strongest question…"
                  value={settings.brief}
                  onChange={(e) => update({ brief: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="field-label">
            Maximum reel length
            <select
              value={settings.target}
              onChange={(e) => update({ target: Number(e.target.value) as Settings["target"] })}
            >
              {[15, 30, 60, 90].map((t) => (
                <option key={t} value={t}>
                  {t} seconds
                </option>
              ))}
            </select>
          </label>
          <div className="field-label">Subtitle timing</div>
          <p>
            {project.subtitleFile
              ? project.subtitleFile
              : "Automatic speech recognition. You can also supply timed captions in an SRT file."}
          </p>
          <input
            type="file"
            ref={srt}
            hidden
            accept=".srt"
            aria-label="Subtitle file"
            onChange={(e) => void attachSrt(e.target.files?.[0])}
          />
          <button className="secondary wide" disabled={pending} onClick={() => srt.current?.click()}>
            <Upload size={15} />
            Attach SRT
          </button>
          <button className="primary wide" disabled={pending} onClick={() => setDialog(null)}>
            Done <Check size={15} />
          </button>
        </Modal>
      )}
      {dialog === "decisions" && project.edit && (
        <Modal title="Director decisions" close={() => setDialog(null)}>
          <p>
            {project.edit.seconds.toFixed(1)}s ·{" "}
            {library.formats.find((f) => f.id === project.edit!.settings.format)?.name} ·{" "}
            {project.edit.settings.director === "claude" ? "Claude Code" : "Local director"}
          </p>
          {project.edit.decisions.map((d) => (
            <div key={d.title} className="decision">
              <strong>{d.title}</strong>
              <p>{d.detail}</p>
            </div>
          ))}
          <a className="secondary wide" href={`/api/projects/${project.id}/edl`} download>
            <ArrowDownToLine size={15} />
            Download edit decision list
          </a>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
