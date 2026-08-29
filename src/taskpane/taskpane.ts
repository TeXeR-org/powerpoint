import {
  checkHealth,
  deleteHistoryFile,
  loadPackagedServerToken,
  LocalServerError,
  openHistoryFile,
  renderFullLatex,
  saveHistoryFile,
} from "../core/local-server-client";
import { loadHistory, recordHistory, removeHistoryEntry } from "../core/history";
import { insertPngIntoSlide, insertSvgIntoSlideExperimental, isInsideOffice } from "../core/office-insert";
import { QuickMathError, renderMathToSvg } from "../core/quick-math";
import { loadSettings, saveSettings } from "../core/settings";
import { looksLikeFullLatex, SNIPPETS } from "../core/snippets";
import { computeRasterSize, CSS_PX_PER_INCH, prepareSvgForOffice, svgToDownloadUrl, svgToPng } from "../core/svg-utils";
import { FontMode, HistoryEntry, PreviewBackground, RenderMode, Settings, TabName, TexEngine } from "../core/types";

const TIKZ_LIBRARY_CHIPS: { label: string; line: string }[] = [
  { label: "arrows.meta", line: "\\usetikzlibrary{arrows.meta}" },
  { label: "positioning", line: "\\usetikzlibrary{positioning}" },
  { label: "calc", line: "\\usetikzlibrary{calc}" },
  { label: "matrix", line: "\\usetikzlibrary{matrix}" },
  { label: "shapes", line: "\\usetikzlibrary{shapes.geometric,shapes.symbols}" },
  { label: "fit", line: "\\usetikzlibrary{fit,backgrounds}" },
  { label: "decorations", line: "\\usetikzlibrary{decorations.pathmorphing,decorations.markings}" },
  { label: "intersections", line: "\\usetikzlibrary{intersections}" },
  { label: "patterns", line: "\\usetikzlibrary{patterns.meta}" },
  { label: "circuitikz", line: "\\usepackage{circuitikz}" },
  { label: "chemfig", line: "\\usepackage{chemfig}" },
  { label: "pgfplots", line: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}" },
  { label: "forest", line: "\\usepackage{forest}" },
];

const TIKZ_TEMPLATES: { id: string; label: string; source: string }[] = [
  {
    id: "canvas",
    label: "Blank canvas",
    source: "\\begin{tikzpicture}\n  % Draw here.\n\\end{tikzpicture}",
  },
  {
    id: "arrow",
    label: "Labeled arrow",
    source:
      "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.4cm]\n  \\node (a) {$A$};\n  \\node (b) [right=of a] {$B$};\n  \\draw[-{Stealth}] (a) -- node[above] {$f$} (b);\n\\end{tikzpicture}",
  },
  {
    id: "diagram",
    label: "Commutative square",
    source:
      "\\usetikzlibrary{arrows.meta,matrix}\n\\begin{tikzpicture}\n  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.6em]\n    { A & B \\\\\n      C & D \\\\ };\n  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
  },
  {
    id: "flow",
    label: "Flowchart",
    source:
      "\\usetikzlibrary{arrows.meta,positioning,shapes.geometric}\n\\begin{tikzpicture}[node distance=11mm, every node/.style={draw, rounded corners, minimum width=25mm, minimum height=8mm}]\n  \\node (start) {Start};\n  \\node (next) [below=of start] {Next step};\n  \\draw[-{Stealth}] (start) -- (next);\n\\end{tikzpicture}",
  },
];

type Workspace = "math" | "latex" | "boxes" | "tikz";

// Percent bounds for the box width control. The upper bound exists only to
// stop a typo turning into an enormous compile. Anything up to 500% is a
// perfectly valid box, since standalone crops to the content.
const MIN_BOX_PERCENT = 5;
const MAX_BOX_PERCENT = 500;

// Default accent per box type. The background tint is derived from whatever
// accent is active (see tintFromAccent), so a custom colour still produces a
// matching callout instead of a clashing one.
const BOX_ACCENTS: Record<string, string> = {
  Theorem: "222B82",
  Proposition: "222B82",
  Lemma: "A5410D",
  Corollary: "39558B",
  Definition: "17636C",
  Remark: "5A6270",
  Example: "366D43",
};

// Minimal stroke icons for the Recents row actions, kept as plain path
// strings so list items can be built purely in JS without extra markup.
const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

let settings: Settings = loadSettings();
let mode: RenderMode = settings.defaultMode;
let activeTab: TabName = "recents";
let activeWorkspace: Workspace = mode === "quick" ? "math" : "latex";

// Per-workspace drafts. Switching Math <-> LaTeX <-> Boxes <-> TikZ swaps the
// textarea contents instead of carrying one shared buffer between them, and
// they're persisted so reopening the pane restores what you were writing in
// each one. `workspaceSourcesReady` gates the swap during boot, before the
// textarea has been seeded. Otherwise the first setWorkspace() call would
// stash an empty string over a restored draft.
const WORKSPACE_SOURCES_KEY = "texer-ppt.workspace-sources.v1";
const workspaceSources: Record<Workspace, string> = { math: "", latex: "", boxes: "", tikz: "" };
let workspaceSourcesReady = false;

// Once you hand-edit generated box source, the builder stops overwriting it
// from under you. Regenerating becomes explicit (the "Use box source"
// button) instead of something a stray click on a colour swatch does.
let lastGeneratedBoxSource = "";
let boxSourceDirty = false;

function loadWorkspaceSources(): void {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SOURCES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Record<Workspace, unknown>>;
    for (const key of ["math", "latex", "boxes", "tikz"] as Workspace[]) {
      if (typeof parsed[key] === "string") workspaceSources[key] = parsed[key] as string;
    }
  } catch {
    /* corrupt or unavailable storage just means everyone starts empty */
  }
}

function saveWorkspaceSources(): void {
  try {
    window.localStorage.setItem(WORKSPACE_SOURCES_KEY, JSON.stringify(workspaceSources));
  } catch {
    /* best-effort */
  }
}

let lastSvg: string | null = null;
let lastRawSvg: string | null = null;
let lastSource = "";
let lastRenderKey: string | null = null;
let packagedTokenLoad: Promise<void> = Promise.resolve();

const LIGHT_MATH = "#171717";
const DARK_MATH = "#f5f5f5";

function applyTheme(theme: Settings["theme"]): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.title = theme === "dark" ? "Light" : "Dark";
  const colorInput = document.getElementById("math-color") as HTMLInputElement | null;
  const autoInk = settings.mathColor === LIGHT_MATH || settings.mathColor === DARK_MATH || settings.mathColor === "#1a1a1a";
  if (colorInput && autoInk) {
    settings.mathColor = theme === "dark" ? DARK_MATH : LIGHT_MATH;
    colorInput.value = settings.mathColor;
  }
}

function toggleTheme(): void {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applyTheme(settings.theme);
  saveSettings(settings);
}

function sourceBox(): HTMLTextAreaElement {
  return el("source");
}

function setStatus(message: string, kind: "" | "ok" | "err" = ""): void {
  const node = el("status");
  node.textContent = message;
  node.className = `status${kind ? " " + kind : ""}`;
}

const PREVIEW_BACKGROUNDS: PreviewBackground[] = ["checker", "white", "black"];
const PREVIEW_BACKGROUND_LABELS: Record<PreviewBackground, string> = {
  checker: "Transparent",
  white: "White",
  black: "Black",
};

/**
 * Preview backdrop only. Light ink is invisible on a white slide and dark
 * ink is invisible on a dark one, and the checkerboard hides both problems,
 * so being able to flip the backdrop is how you actually check contrast
 * before inserting. What gets inserted is unaffected; that is the
 * "Transparent background" setting.
 */
function setPreviewBackground(next: PreviewBackground, { save }: { save: boolean }): void {
  settings.previewBackground = next;
  const preview = el("preview");
  preview.classList.toggle("checker", next === "checker");
  preview.classList.toggle("on-white", next === "white");
  preview.classList.toggle("on-black", next === "black");

  const button = el("preview-bg");
  button.dataset.bg = next;
  button.title = `Preview background: ${PREVIEW_BACKGROUND_LABELS[next]}. Click to cycle.`;
  el("preview-bg-label").textContent = PREVIEW_BACKGROUND_LABELS[next];

  if (save) saveSettings(settings);
}

function cyclePreviewBackground(): void {
  const index = PREVIEW_BACKGROUNDS.indexOf(settings.previewBackground);
  const next = PREVIEW_BACKGROUNDS[(index + 1) % PREVIEW_BACKGROUNDS.length];
  setPreviewBackground(next, { save: true });
}

function setActiveTab(tab: TabName): void {
  activeTab = tab;
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tab);
  });
  if (tab === "recents") renderRecentsList();
}

function setMode(next: RenderMode, { user }: { user: boolean }): void {
  mode = next;
  el("quick-opts").classList.toggle("hidden", next !== "quick");
  el("full-opts").classList.toggle("hidden", next !== "full");
  if (user) {
    settings.defaultMode = next;
    saveSettings(settings);
  }
}

function setWorkspace(next: Workspace, { user }: { user: boolean }): void {
  // Each workspace keeps its own draft, so flipping Math -> TikZ -> Math
  // doesn't cost you what you were writing. Stash the outgoing one before
  // swapping the textarea over to the incoming one.
  if (workspaceSourcesReady && next !== activeWorkspace) {
    workspaceSources[activeWorkspace] = sourceBox().value;
    saveWorkspaceSources();
  }
  const switching = next !== activeWorkspace;

  activeWorkspace = next;
  const nextMode: RenderMode = next === "math" ? "quick" : "full";
  setMode(nextMode, { user });

  document.querySelectorAll<HTMLButtonElement>(".mode").forEach((btn) => {
    const on = btn.dataset.workspace === next;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", String(on));
  });

  if (workspaceSourcesReady && switching) {
    sourceBox().value = workspaceSources[next] || "";
  }

  el("box-builder").classList.toggle("hidden", next !== "boxes");
  el("tikz-tools").classList.toggle("hidden", next !== "tikz");
  const sourceField = el<HTMLElement>("source-field");
  if (next === "boxes") el("box-builder").before(sourceField);
  else el("mode-hint").after(sourceField);
  renderSnippetOptions();

  const hints: Record<Workspace, string> = {
    math: "Fast equations and aligned math. Renders in the pane, no TeX installation needed.",
    latex: "Full LaTeX source. Preamble declarations at the top are handled automatically.",
    boxes: "Build clean theorem-style boxes. Only the small tcolorbox dependency is added.",
    tikz: "Write TikZ directly, then add libraries or a starter diagram below as needed.",
  };
  el("mode-hint").textContent = hints[next];
}

function renderSnippetOptions(): void {
  const select = el<HTMLSelectElement>("snippet-select");
  const canShowExamples = activeWorkspace !== "boxes";
  select.classList.toggle("hidden", !canShowExamples);
  select.innerHTML = '<option value="">Examples</option>';
  if (!canShowExamples) return;

  for (const snippet of SNIPPETS.filter((item) => item.workspace === activeWorkspace)) {
    const option = document.createElement("option");
    option.value = snippet.id;
    option.textContent = snippet.label;
    select.append(option);
  }
}

function currentSource(): string {
  return sourceBox().value;
}

function insertLine(line: string): void {
  const box = sourceBox();
  const existing = box.value;
  if (existing.includes(line)) return;
  setSourceValue(existing.trim() ? `${line}\n${existing}` : `${line}\n`);
  box.focus();
}

/** Sets the editor contents and keeps the active workspace's draft in sync. */
function setSourceValue(value: string): void {
  sourceBox().value = value;
  if (workspaceSourcesReady) {
    workspaceSources[activeWorkspace] = value;
    saveWorkspaceSources();
  }
}

function sourceLooksLikeTikz(source: string): boolean {
  return /\\begin\{tikzpicture\}|\\tikz(?:set|picture)?\b|\\draw\b|\\node\b/.test(source);
}

function buildBoxSource(): string {
  const type = el<HTMLSelectElement>("box-type").value || "Theorem";
  const number = el<HTMLInputElement>("box-number").value.trim();
  const title = el<HTMLInputElement>("box-title").value.trim();
  const content = el<HTMLTextAreaElement>("box-content").value.trim();
  const accent = texHtmlColor(el<HTMLInputElement>("box-color").value, BOX_ACCENTS[type] || BOX_ACCENTS.Theorem);
  const background = tintFromAccent(accent);
  const textColor = texHtmlColor(settings.boxTextColor, "171717");
  const label = [type, number].filter(Boolean).join(" ");
  const heading = title
    ? `{\\color{texerBoxAccent}\\bfseries ${label}} {\\color{texerBoxAccent}${title}}`
    : `{\\color{texerBoxAccent}\\bfseries ${label}}`;

  // The tcolorbox is wrapped in a minipage of the requested width, and then
  // sized to \linewidth *inside* it. This is load-bearing: on its own, a
  // narrow tcolorbox still sits in a full-width paragraph, so standalone's
  // `preview` cropping measures the paragraph and every box comes out the
  // same width with the difference padded as whitespace, which reads as
  // "the width setting does nothing". Inside a minipage, \linewidth IS the
  // requested width and the crop lands on the box itself.
  //
  // No `height` key: tcolorbox sizes itself to the content at that width,
  // which is what "auto height" means here. Body text stays on LaTeX's
  // default justified setting; nothing sets raggedright.
  return [
    "\\usepackage[most]{tcolorbox}",
    `\\definecolor{texerBoxAccent}{HTML}{${accent}}`,
    `\\definecolor{texerBoxBackground}{HTML}{${background}}`,
    `\\definecolor{texerBoxText}{HTML}{${textColor}}`,
    `\\begin{minipage}{${boxWidthExpression()}}`,
    "\\begin{tcolorbox}[",
    "  enhanced,",
    "  frame hidden,",
    "  sharp corners,",
    "  colback=texerBoxBackground,",
    "  coltext=texerBoxText,",
    "  borderline west={1.25mm}{0pt}{texerBoxAccent},",
    "  width=\\linewidth,",
    "  left=4mm, right=4mm, top=3.2mm, bottom=3.2mm,",
    "  before skip=0pt, after skip=0pt,",
    "]",
    `${heading}\\\\[1.2mm]`,
    content || "% Write the statement here. Inline math such as $f\\colon A \\to B$ is supported.",
    "\\end{tcolorbox}",
    "\\end{minipage}",
  ].join("\n");
}

/**
 * Turns the width value + unit into a TeX dimension. Percent is a fraction
 * of the surrounding \linewidth and is not capped at 100, because
 * standalone crops to whatever the content actually measures, so a box
 * wider than the nominal line width is perfectly valid.
 */
function boxWidthExpression(): string {
  const raw = Number(el<HTMLInputElement>("box-width").value);
  const unit = el<HTMLSelectElement>("box-width-unit").value || "%";
  if (!Number.isFinite(raw) || raw <= 0) return "\\linewidth";

  if (unit === "%") {
    const fraction = clampNumber(raw, MIN_BOX_PERCENT, MAX_BOX_PERCENT, 100) / 100;
    if (Math.abs(fraction - 1) < 0.001) return "\\linewidth";
    return `${trimNumber(fraction)}\\linewidth`;
  }
  return `${trimNumber(raw)}${unit}`;
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Mixes the accent toward white to get the whisper-light callout tint. */
function tintFromAccent(hex: string, weight = 0.94): string {
  const channel = (start: number) => {
    const base = parseInt(hex.slice(start, start + 2), 16);
    const mixed = Math.round(base + (255 - base) * weight);
    return Math.min(255, Math.max(0, mixed)).toString(16).padStart(2, "0").toUpperCase();
  };
  return `${channel(0)}${channel(2)}${channel(4)}`;
}

function texHtmlColor(value: string, fallback: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? match[1].toUpperCase() : fallback;
}

function syncBoxSource(): void {
  const generated = buildBoxSource();
  lastGeneratedBoxSource = generated;
  boxSourceDirty = false;
  setSourceValue(generated);
}

function applySettingsToForm(): void {
  el<HTMLInputElement>("set-url").value = settings.serverUrl;
  el<HTMLInputElement>("set-token").value = settings.serverToken;
  el<HTMLTextAreaElement>("set-preamble").value = settings.extraPreamble;
  el<HTMLInputElement>("set-border").value = settings.border;
  el<HTMLSelectElement>("set-fontmode").value = settings.fontMode;
  el<HTMLInputElement>("set-width").value = String(settings.insertWidthIn);
  el<HTMLInputElement>("set-scale").value = String(settings.rasterScale);
  el<HTMLInputElement>("set-transparent").checked = settings.transparentBackground;
  el<HTMLSelectElement>("engine").value = settings.engine;
  el<HTMLInputElement>("math-color").value = settings.mathColor;
  el<HTMLInputElement>("set-box-text-color").value = settings.boxTextColor;
  el<HTMLInputElement>("math-scale").value = String(settings.mathScale);
  el<HTMLInputElement>("math-spacing").value = String(settings.mathSpacing);
}

function readSettingsFromForm(): Settings {
  settings = {
    ...settings,
    serverUrl: el<HTMLInputElement>("set-url").value.trim(),
    serverToken: el<HTMLInputElement>("set-token").value.trim(),
    extraPreamble: el<HTMLTextAreaElement>("set-preamble").value,
    theme: settings.theme,
    border: el<HTMLInputElement>("set-border").value.trim() || "2pt",
    fontMode: el<HTMLSelectElement>("set-fontmode").value as FontMode,
    insertWidthIn: Number(el<HTMLInputElement>("set-width").value) || 3,
    rasterScale: Number(el<HTMLInputElement>("set-scale").value) || 4,
    transparentBackground: el<HTMLInputElement>("set-transparent").checked,
    engine: el<HTMLSelectElement>("engine").value as TexEngine,
    mathColor: el<HTMLInputElement>("math-color").value,
    boxTextColor: el<HTMLInputElement>("set-box-text-color").value,
    mathScale: clampNumber(Number(el<HTMLInputElement>("math-scale").value), 50, 200, 100),
    mathSpacing: clampNumber(Number(el<HTMLInputElement>("math-spacing").value), -20, 40, 0),
  };
  saveSettings(settings);
  return settings;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function styledSvg(raw: string): string {
  return prepareSvgForOffice(raw, {
    color: mode === "quick" ? settings.mathColor : undefined,
    scale: settings.mathScale / 100,
    spacing: settings.mathSpacing,
    widthPx: targetWidthInches() * CSS_PX_PER_INCH,
  });
}

function restylePreview(): void {
  if (!lastRawSvg) return;
  showPreview(styledSvg(lastRawSvg));
  // The restyled image genuinely reflects the new settings, so refresh the
  // key too; otherwise the next insert would trigger a pointless recompile.
  lastRenderKey = renderKey(lastSource);
}

function showPreview(svg: string): void {
  const preview = el("preview");
  preview.innerHTML = svg;
  lastSvg = svg;
  const ready = true;
  el<HTMLButtonElement>("btn-insert").disabled = !ready;
  el<HTMLButtonElement>("btn-insert-svg").disabled = !ready;
  el<HTMLButtonElement>("btn-download").disabled = !ready;
  el<HTMLButtonElement>("btn-copy").disabled = !ready;
}

async function probeServer(): Promise<void> {
  const pill = el("server-pill");
  const health = await checkHealth(settings);
  const engines = health.engines.length ? health.engines.join(", ") : "no engines";
  const ready = health.ok && health.engines.length > 0 && !!health.svgTool;
  pill.textContent = ready ? "TeX" : "Off";
  pill.className = ready ? "pill ok" : "pill bad";
  pill.title = ready ? `${engines} · ${health.svgTool}` : "Start ppt/local-server";
}

async function renderNow(): Promise<string> {
  // In the packaged app the token is loaded from the same HTTPS origin on
  // boot. Await it here as well so the very first render cannot race it.
  await packagedTokenLoad;
  readSettingsFromForm();
  const source = currentSource().trim();
  if (!source) throw new Error("Type some LaTeX first.");

  if (mode === "quick" && looksLikeFullLatex(source)) {
    setStatus("This needs a TeX engine. Switching workspaces.", "ok");
    setWorkspace(sourceLooksLikeTikz(source) ? "tikz" : "latex", { user: true });
    // Carry the text across with it. Workspaces keep separate drafts now, so
    // without this the switch would swap in the target workspace's old draft
    // and the source being rendered would vanish from the editor.
    setSourceValue(source);
  }

  setStatus(mode === "quick" ? "Rendering..." : "Compiling with local TeX...");

  let svg: string;
  if (mode === "quick") {
    svg = await renderMathToSvg(source, {
      display: el<HTMLInputElement>("display-math").checked,
      color: settings.mathColor,
    });
  } else {
    const result = await renderFullLatex(settings, {
      source,
      engine: settings.engine,
      preamble: settings.extraPreamble,
      border: settings.border,
      fontMode: settings.fontMode,
    });
    if (!result.success || !result.svg) {
      throw new Error((result.errors && result.errors.join("\n")) || "Compile failed.");
    }
    svg = result.svg;
    if (result.duration) setStatus(`Compiled in ${result.duration} ms`, "ok");
  }

  lastRawSvg = svg;
  lastSource = source;
  lastRenderKey = renderKey(source);
  const prepared = styledSvg(svg);
  showPreview(prepared);
  if (mode === "quick") setStatus("Rendered.", "ok");

  const entries = recordHistory(source, mode);
  const newest = entries[0];
  if (newest) {
    saveHistoryFile(settings, newest.id, prepared).catch(() => {
      /* best-effort; "open file location" just won't find anything for this one */
    });
  }
  if (activeTab === "recents") renderRecentsList();

  return prepared;
}

/**
 * Physical width the current render should end up at, in inches.
 *
 * The Boxes workspace has its own width control, and it has to drive the
 * real output size. Otherwise the LaTeX width only changes where the text
 * wraps and every box still lands on the slide at exactly settings.insertWidthIn,
 * which reads as "the width setting does nothing".
 *
 * Percent is taken against the default insert width; absolute units are
 * literal (10cm really is 10cm on the slide).
 */
function targetWidthInches(): number {
  if (activeWorkspace !== "boxes") return settings.insertWidthIn;

  const raw = Number(el<HTMLInputElement>("box-width").value);
  const unit = el<HTMLSelectElement>("box-width-unit").value || "%";
  if (!Number.isFinite(raw) || raw <= 0) return settings.insertWidthIn;

  switch (unit) {
    case "mm":
      return raw / 25.4;
    case "cm":
      return raw / 2.54;
    case "in":
      return raw;
    case "pt":
      return raw / 72;
    default:
      return settings.insertWidthIn * (clampNumber(raw, MIN_BOX_PERCENT, MAX_BOX_PERCENT, 100) / 100);
  }
}

async function pngFromSvg(svg: string): Promise<{ base64: string; widthPt: number; heightPt: number }> {
  const widthIn = targetWidthInches() * (settings.mathScale / 100);
  const size = computeRasterSize(svg, widthIn, settings.rasterScale);
  const png = await svgToPng(svg, size.widthPx, size.heightPx, {
    backgroundColor: settings.transparentBackground ? undefined : "#ffffff",
  });
  return { base64: png.base64, widthPt: size.widthPt, heightPt: size.heightPt };
}

/**
 * Identity of a render: everything that can change the produced image.
 *
 * ensureSvg() used to compare source text alone, which happened to be
 * correct only because every appearance setting also either rewrote the
 * source or forced a re-style. That is one new setting away from silently
 * inserting a stale image, so key the cache on the inputs themselves.
 */
function renderKey(source: string): string {
  return JSON.stringify([
    source,
    mode,
    activeWorkspace,
    settings.mathColor,
    settings.mathScale,
    settings.mathSpacing,
    settings.engine,
    settings.border,
    settings.fontMode,
    settings.extraPreamble,
    settings.boxTextColor,
    targetWidthInches(),
    el<HTMLInputElement>("display-math").checked,
  ]);
}

async function ensureSvg(): Promise<string> {
  const source = currentSource().trim();
  if (lastSvg && lastRenderKey === renderKey(source)) return lastSvg;
  return renderNow();
}

async function insertPicture(): Promise<void> {
  if (!isInsideOffice()) {
    throw new Error("Open this task pane from PowerPoint to insert.");
  }
  const svg = await ensureSvg();
  const png = await pngFromSvg(svg);
  await insertPngIntoSlide(png.base64, { widthPt: png.widthPt, heightPt: png.heightPt });
  setStatus("Inserted as a picture.", "ok");
}

async function insertSvg(): Promise<void> {
  if (!isInsideOffice()) {
    throw new Error("Open this task pane from PowerPoint to insert.");
  }
  const svg = await ensureSvg();
  const size = computeRasterSize(svg, targetWidthInches() * (settings.mathScale / 100), settings.rasterScale);
  await insertSvgIntoSlideExperimental(svg, { widthPt: size.widthPt, heightPt: size.heightPt });
  setStatus("Inserted as SVG.", "ok");
}

function downloadSvg(): void {
  if (!lastSvg) return;
  const url = svgToDownloadUrl(lastSvg);
  const a = document.createElement("a");
  a.href = url;
  a.download = "texer.svg";
  a.click();
  URL.revokeObjectURL(url);
}

async function copySvg(): Promise<void> {
  if (!lastSvg) return;
  await copyText(lastSvg);
  setStatus("SVG copied to the clipboard.", "ok");
}

/**
 * Copies text, with a fallback for the task pane.
 *
 * navigator.clipboard.writeText rejects with "Document is not focused" when
 * PowerPoint has focus on the slide rather than the pane, which is exactly
 * the situation you're in when reaching for a Copy button. Fall back to a
 * throwaway textarea plus execCommand, which has no focus requirement.
 */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to the legacy path */
  }

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.top = "-1000px";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  scratch.setSelectionRange(0, scratch.value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(scratch);
  if (!ok) throw new Error("Could not copy. Select the text and copy it manually.");
}

// ── Recents tab ──────────────────────────────────────────────────
function truncatedLabel(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function renderRecentsList(): void {
  const list = el("recents-list");
  const empty = el("recents-empty");
  const entries = loadHistory();

  list.innerHTML = "";
  empty.classList.toggle("hidden", entries.length > 0);

  for (const entry of entries) {
    list.append(buildRecentItem(entry));
  }
}

function buildRecentItem(entry: HistoryEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = "recent-item";

  const text = document.createElement("button");
  text.type = "button";
  text.className = "recent-text";
  text.textContent = truncatedLabel(entry.source);
  text.title = entry.source;
  text.addEventListener("click", () => {
    // Switch first: setWorkspace swaps in that workspace's stored draft,
    // so writing the source before it would just get overwritten.
    setWorkspace(entry.mode === "quick" ? "math" : sourceLooksLikeTikz(entry.source) ? "tikz" : "latex", {
      user: true,
    });
    setSourceValue(entry.source);
    sourceBox().focus();
  });

  const actions = document.createElement("div");
  actions.className = "recent-actions";

  const copyBtn = makeIconButton(ICON_COPY, "Copy source", async () => {
    await copyText(entry.source);
    setStatus("Source copied to the clipboard.", "ok");
  });

  const openBtn = makeIconButton(ICON_FOLDER, "Open file location", async () => {
    const result = await openHistoryFile(settings, entry.id);
    if (!result.success) throw new Error((result.errors && result.errors[0]) || "Could not open file location.");
    setStatus("Opened the render in Explorer.", "ok");
  });

  const trashBtn = makeIconButton(ICON_TRASH, "Delete", async () => {
    removeHistoryEntry(entry.id);
    renderRecentsList();
    deleteHistoryFile(settings, entry.id).catch(() => {
      /* best-effort */
    });
  });
  trashBtn.classList.add("danger");

  actions.append(copyBtn, openBtn, trashBtn);
  row.append(text, actions);
  return row;
}

function makeIconButton(iconSvg: string, title: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = title;
  btn.innerHTML = iconSvg;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    Promise.resolve(onClick()).catch((err) => setStatus(formatError(err), "err"));
  });
  return btn;
}

function bindUi(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as TabName | undefined;
      if (tab) setActiveTab(tab);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      const workspace = btn.dataset.workspace as Workspace | undefined;
      if (workspace) setWorkspace(workspace, { user: true });
    });
  });
  el("theme-toggle").addEventListener("click", toggleTheme);
  el("preview-bg").addEventListener("click", cyclePreviewBackground);

  const select = el<HTMLSelectElement>("snippet-select");
  renderSnippetOptions();
  select.addEventListener("change", () => {
    const snippet = SNIPPETS.find((s) => s.id === select.value);
    select.value = "";
    if (!snippet) return;
    setWorkspace(snippet.workspace, { user: true });
    setSourceValue(snippet.source);
  });

  const chips = el("tikz-library-chips");
  for (const chip of TIKZ_LIBRARY_CHIPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = chip.label;
    btn.addEventListener("click", () => {
      setWorkspace("tikz", { user: true });
      insertLine(chip.line);
    });
    chips.append(btn);
  }

  const tikzStarter = el<HTMLSelectElement>("tikz-starter");
  for (const template of TIKZ_TEMPLATES) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    tikzStarter.append(option);
  }
  tikzStarter.addEventListener("change", () => {
    const template = TIKZ_TEMPLATES.find((item) => item.id === tikzStarter.value);
    tikzStarter.value = "";
    if (!template) return;
    setWorkspace("tikz", { user: true });
    setSourceValue(template.source);
    sourceBox().focus();
  });

  const syncBox = () => {
    setWorkspace("boxes", { user: true });
    if (boxSourceDirty) {
      setStatus("Source was edited by hand, so it was left alone. Use box source to regenerate it.");
      return;
    }
    syncBoxSource();
  };

  // Switching type re-seeds the colour with that type's default, so the
  // presets stay one click away while still being overridable.
  el("box-type").addEventListener("change", () => {
    const type = el<HTMLSelectElement>("box-type").value || "Theorem";
    el<HTMLInputElement>("box-color").value = `#${(BOX_ACCENTS[type] || BOX_ACCENTS.Theorem).toLowerCase()}`;
  });

  for (const id of [
    "box-type",
    "box-number",
    "box-title",
    "box-width",
    "box-width-unit",
    "box-color",
    "box-content",
  ]) {
    el(id).addEventListener("input", syncBox);
    el(id).addEventListener("change", syncBox);
  }
  el("btn-build-box").addEventListener("click", () => {
    // Explicit regenerate: this is the one action that is allowed to
    // overwrite hand-edited source.
    setWorkspace("boxes", { user: true });
    syncBoxSource();
    sourceBox().focus();
    setStatus("Box source is ready to render.", "ok");
  });

  el("btn-render").addEventListener("click", () => {
    renderNow().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-insert").addEventListener("click", () => {
    insertPicture().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-insert-svg").addEventListener("click", () => {
    insertSvg().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-download").addEventListener("click", downloadSvg);
  el("btn-copy").addEventListener("click", () => {
    copySvg().catch((err) => setStatus(formatError(err), "err"));
  });
  el("btn-check").addEventListener("click", () => {
    readSettingsFromForm();
    probeServer()
      .then(() => setStatus("Reached the local server.", "ok"))
      .catch((err) => setStatus(formatError(err), "err"));
  });
  el("server-pill").addEventListener("click", () => {
    setActiveTab("settings");
    probeServer().catch((err) => setStatus(formatError(err), "err"));
  });

  for (const id of [
    "set-url",
    "set-token",
    "set-preamble",
    "set-border",
    "set-fontmode",
    "set-width",
    "set-scale",
    "set-transparent",
    "engine",
    "math-color",
    "set-box-text-color",
    "math-scale",
    "math-spacing",
  ]) {
    el(id).addEventListener("change", () => {
      readSettingsFromForm();
      if (id === "math-color" || id === "math-scale" || id === "math-spacing" || id === "set-width") {
        restylePreview();
      }
      if (id === "set-box-text-color" && activeWorkspace === "boxes") syncBoxSource();
    });
  }

  el("display-math").addEventListener("change", () => {
    if (lastSource) renderNow().catch((err) => setStatus(formatError(err), "err"));
  });

  sourceBox().addEventListener("input", () => {
    if (workspaceSourcesReady) {
      workspaceSources[activeWorkspace] = sourceBox().value;
      saveWorkspaceSources();
    }
    if (activeWorkspace === "boxes" && sourceBox().value !== lastGeneratedBoxSource) {
      boxSourceDirty = true;
    }
  });

  sourceBox().addEventListener("keydown", (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      if (ev.shiftKey) insertPicture().catch((err) => setStatus(formatError(err), "err"));
      else renderNow().catch((err) => setStatus(formatError(err), "err"));
    }
  });
}

function formatError(err: unknown): string {
  if (err instanceof LocalServerError || err instanceof QuickMathError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function boot(): void {
  applyTheme(settings.theme);
  applySettingsToForm();
  loadWorkspaceSources();
  setPreviewBackground(settings.previewBackground, { save: false });
  setWorkspace(activeWorkspace, { user: false });
  // Seed the textarea with the restored draft for whichever workspace we
  // opened in, then let switches start swapping drafts from here on.
  sourceBox().value = workspaceSources[activeWorkspace] || "";
  workspaceSourcesReady = true;
  setActiveTab("recents");
  bindUi();
  packagedTokenLoad = loadPackagedServerToken().then((token) => {
    if (!token) return;
    settings = { ...settings, serverToken: token };
    saveSettings(settings);
    el<HTMLInputElement>("set-token").value = token;
  });
  probeServer().catch(() => {
    el("server-pill").textContent = "Off";
    el("server-pill").className = "pill bad";
  });
  if (!isInsideOffice()) {
    setStatus("Preview only. Insert needs PowerPoint.");
  }
}

let booted = false;
function bootOnce(): void {
  if (booted) return;
  booted = true;
  boot();
}

if (typeof Office !== "undefined") {
  Office.onReady(() => bootOnce());
} else {
  window.addEventListener("DOMContentLoaded", bootOnce);
}
