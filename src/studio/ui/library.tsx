import { Activity, ChevronRight, FileVideo, Plus } from "lucide-react";
import type { Format } from "../formats";
import type { Project } from "../model";
import { media, timecode } from "./monitor";
export type Library = { example: Project; formats: Format[]; projects: Project[] };
interface LibraryProps {
  page: "Projects" | "Formats";
  library: Library;
  onCreate: () => void;
  onProject: (project: Project) => void;
  onFormat: (format: Format) => void;
}
export function WorkspaceLibrary({ page, library, onCreate, onProject, onFormat }: LibraryProps) {
  return (
    <>
      <div className="project-heading library-heading">
        <div>
          <div className="crumb">
            <span className="studio-mark" />
            Workspace
            <ChevronRight size={12} />
            {page}
          </div>
          <h1>{page === "Projects" ? "Project library" : "Format library"}</h1>
          <p>
            {page === "Projects"
              ? "Open a source video or return to a finished edit."
              : "Choose an editing style or learn one from a reference video."}
          </p>
        </div>
        <button className="primary" onClick={() => onCreate()}>
          <Plus size={17} />
          {page === "Projects" ? "New project" : "Learn a format"}
        </button>
      </div>
      {page === "Projects" ? (
        <div className="library-grid">
          {[...library.projects, library.example].map((p) => (
            <button key={p.id} className="library-card" onClick={() => onProject(p)}>
              <div className="cover">
                <img src={media(p, "poster.jpg")} alt="" />
                <span>{timecode(p.edit?.seconds ?? p.seconds)}</span>
              </div>
              <div className="card-body">
                <small>
                  <FileVideo size={13} />
                  {p.id === "sample" ? "Sample project" : p.edit ? "Edited reel" : "Source footage"}
                </small>
                <h2>{p.title}</h2>
                <p>{p.filename}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="library-grid">
          {library.formats.map((f) => (
            <button key={f.id} className="library-card" onClick={() => onFormat(f)}>
              <div className="cover">
                <img src={f.image} alt="" />
                <span>{f.reference ? "Learned format" : "Studio format"}</span>
              </div>
              <div className="card-body">
                <small>
                  <Activity size={13} />
                  {f.shotSeconds.toFixed(1)}s pacing · {f.transition}
                </small>
                <h2>{f.name}</h2>
                <p>{f.description}</p>
                {f.reference && (
                  <p>
                    Motion {f.reference.motion.toFixed(1)} · {f.reference.flashes} flashes ·{" "}
                    {f.reference.lufs === null ? "No audio level" : f.reference.lufs + " LUFS"}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
