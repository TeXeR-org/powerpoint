// Shared types for the TeXeR PowerPoint add-in.

export type TexEngine = "pdflatex" | "xelatex" | "lualatex";
export type FontMode = "path" | "embed";
export type RenderMode = "quick" | "full";
export type ColorTheme = "light" | "dark";
export type TabName = "recents" | "settings" | "info";
/** Backdrop shown behind the preview only. Does not affect what is inserted. */
export type PreviewBackground = "checker" | "white" | "black";

export interface Settings {
  /** Base URL of the local compile server, e.g. http://127.0.0.1:47822 */
  serverUrl: string;
  /** Token printed by the local server on startup. */
  serverToken: string;
  engine: TexEngine;
  fontMode: FontMode;
  border: string;
  /** Extra preamble lines (macros, \usetikzlibrary, ...) applied to every full-LaTeX render. */
  extraPreamble: string;
  /** Default mode the editor opens in. */
  defaultMode: RenderMode;
  theme: ColorTheme;
  /** Foreground color used for Quick Math rendering (hex, e.g. #111111). */
  mathColor: string;
  /** Foreground color used for the body text of generated theorem-style boxes. */
  boxTextColor: string;
  /** Backdrop behind the preview, for checking a render against a light or dark slide. */
  previewBackground: PreviewBackground;
  /** Preview and insert size, percent. */
  mathScale: number;
  /** Extra horizontal tracking, percent. 0 is unchanged. */
  mathSpacing: number;
  /** Physical width, in inches, used when inserting into the slide. */
  insertWidthIn: number;
  /** Raster scale multiplier applied on top of insertWidthIn (crispness vs. file size). */
  rasterScale: number;
  transparentBackground: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://127.0.0.1:47822",
  serverToken: "",
  engine: "pdflatex",
  fontMode: "path",
  border: "2pt",
  extraPreamble: "",
  defaultMode: "quick",
  theme: "light",
  mathColor: "#171717",
  boxTextColor: "#171717",
  previewBackground: "checker",
  mathScale: 100,
  mathSpacing: 0,
  insertWidthIn: 3,
  rasterScale: 4,
  transparentBackground: true,
};

export interface CompileSvgRequest {
  source: string;
  engine: TexEngine;
  preamble: string;
  border: string;
  fontMode: FontMode;
}

export interface CompileSvgResult {
  success: boolean;
  svg: string | null;
  log?: string;
  errors: string[];
  duration?: number;
}

export interface ServerHealth {
  ok: boolean;
  engines: TexEngine[];
  svgTool: "dvisvgm" | "pdftocairo" | null;
}

export interface HistoryEntry {
  id: string;
  source: string;
  mode: RenderMode;
  createdAt: number;
}
