import { DEFAULT_SETTINGS, PreviewBackground, Settings } from "./types";

const STORAGE_KEY = "texer-ppt.settings.v1";
const PREVIEW_BACKGROUNDS: PreviewBackground[] = ["checker", "white", "black"];

// Server URLs that shipped as defaults in earlier builds. The saved value in
// localStorage would otherwise keep pointing at a port nothing listens on
// any more, and the add-in would come up dead after an update with no
// indication why. Anyone who set a custom URL keeps it.
const LEGACY_SERVER_URLS = ["http://127.0.0.1:4756", "http://localhost:4756"];

function systemTheme(): Settings["theme"] {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function migrateServerUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_SETTINGS.serverUrl;
  const normalised = value.trim().replace(/\/+$/, "");
  return LEGACY_SERVER_URLS.includes(normalised) ? DEFAULT_SETTINGS.serverUrl : value;
}

// Spread-merging a stored blob only fills in *absent* keys, so a stale or
// corrupt value for an enum field would survive and end up driving CSS class
// names that don't exist. Validate the enums explicitly.
function validPreviewBackground(value: unknown): PreviewBackground {
  return PREVIEW_BACKGROUNDS.includes(value as PreviewBackground)
    ? (value as PreviewBackground)
    : DEFAULT_SETTINGS.previewBackground;
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, theme: systemTheme() };
    const parsed = JSON.parse(raw);
    const theme = parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : systemTheme();
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme,
      serverUrl: migrateServerUrl(parsed.serverUrl),
      previewBackground: validPreviewBackground(parsed.previewBackground),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, theme: systemTheme() };
  }
}

export function saveSettings(settings: Settings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}
