import type { Decision, Settings } from "./director";
export interface Cut {
  id: string;
  seconds: number;
  created: string;
  settings: Settings;
  decisions: Decision[];
  segments: { start: number; end: number; source: number; name: string }[];
  captions: { start: number; end: number; text: string }[];
  sounds: { at: number; name: string }[];
  music: boolean;
}
export interface Project {
  id: string;
  title: string;
  filename: string;
  seconds: number;
  hasAudio: boolean;
  created: string;
  subtitleFile?: string;
  edit?: Cut;
}
export interface Job {
  state: "working" | "failed";
  step: string;
  progress?: number;
}
export const sample: Project = {
  id: "sample",
  title: "Alpine field notes",
  filename: "alpine-field-notes.mp4",
  seconds: 12,
  hasAudio: true,
  created: "",
};
