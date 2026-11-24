import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileVideo, LoaderCircle, Upload, X } from "lucide-react";

export function Modal({
  title,
  children,
  close,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  locked?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !locked) close();
      }}
    >
      <div className="dialog-inner">
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close dialog" disabled={locked} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function FileDialog({
  reference,
  close,
  submit,
}: {
  reference: boolean;
  close: () => void;
  submit: (file: File, name: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const pick = (f?: File) => {
    if (f) {
      setFile(f);
      setError("");
      if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
    }
  };
  return (
    <Modal title={reference ? "Learn a format" : "Import footage"} close={close} locked={working}>
      <p>
        {reference
          ? "Upload an edited reference. The director measures its shots, motion and audio, then saves a format for future footage."
          : "Upload your source video to start a new edit. Your footage stays in this workspace."}
      </p>
      <label
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!working) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!working) pick(e.dataTransfer.files[0]);
        }}
      >
        {file ? <FileVideo size={30} /> : <Upload size={30} />}
        <strong>{file?.name ?? "Choose a video or drop it here"}</strong>
        <small>
          {file
            ? `${(file.size / 1048576).toFixed(1)} MB · Click to replace`
            : "MP4, MOV, WebM and more · Up to 512 MB"}
        </small>
        <input
          type="file"
          aria-label={reference ? "Reference video" : "Source video"}
          accept="video/*,.mkv,.mts,.m4v"
          disabled={working}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>
      {reference && (
        <label className="field-label">
          Format name
          <input
            type="text"
            maxLength={60}
            placeholder="My editing format"
            value={name}
            disabled={working}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        disabled={!file || working || (reference && !name.trim())}
        onClick={async () => {
          if (!file) return;
          setWorking(true);
          try {
            await submit(file, name);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Upload failed.");
            setWorking(false);
          }
        }}
      >
        {working ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
        {working
          ? reference
            ? "Analyzing reference…"
            : "Preparing preview…"
          : reference
            ? "Analyze and save format"
            : "Create project"}
      </button>
    </Modal>
  );
}
