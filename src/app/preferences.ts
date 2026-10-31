import { sanitizeConfig, type SimConfig } from '../simulation/config';

/** Small UI preferences only. Training data lives in IndexedDB, never here. */
export type Theme = 'system' | 'dark' | 'light';
export type Quality = 'auto' | 'low' | 'balanced' | 'high';
export type ResolvedQuality = Exclude<Quality, 'auto'>;

export interface Preferences {
  theme: Theme;
  quality: Quality;
  showSensors: boolean;
  showPerf: boolean;
  /** Fill the screen when manual driving starts. */
  maximizeDriving: boolean;
  reducedMotion: 'system' | 'on' | 'off';
}

const KEY = 'autopilot-lab:prefs';
const CONFIG_KEY = 'autopilot-lab:config';
const DEFAULTS: Preferences = {
  theme: 'system',
  quality: 'auto',
  showSensors: true,
  showPerf: false,
  maximizeDriving: true,
  reducedMotion: 'system',
};

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled or full: preferences simply won't persist.
  }
}

export function loadPreferences(): Preferences {
  const p = (read(KEY) ?? {}) as Partial<Record<keyof Preferences, unknown>>;
  return {
    theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : DEFAULTS.theme,
    quality: ['low', 'balanced', 'high'].includes(p.quality as string)
      ? (p.quality as Quality)
      : DEFAULTS.quality,
    showSensors: typeof p.showSensors === 'boolean' ? p.showSensors : DEFAULTS.showSensors,
    showPerf: typeof p.showPerf === 'boolean' ? p.showPerf : DEFAULTS.showPerf,
    maximizeDriving: typeof p.maximizeDriving === 'boolean' ? p.maximizeDriving : DEFAULTS.maximizeDriving,
    reducedMotion:
      p.reducedMotion === 'on' || p.reducedMotion === 'off' ? p.reducedMotion : DEFAULTS.reducedMotion,
  };
}

export const savePreferences = (p: Preferences) => write(KEY, p);
/** The last-used simulation configuration is a small UI preference (a few hundred bytes). */
export const loadLastConfig = (): SimConfig => sanitizeConfig(read(CONFIG_KEY));
export const saveLastConfig = (c: SimConfig) => write(CONFIG_KEY, c);

/** Device-aware default: weaker devices (few cores / little memory / small touch screens) get lower quality. */
export function resolveQuality(q: Quality): ResolvedQuality {
  if (q !== 'auto') return q;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const touchSmall = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  if (cores <= 2 || memory <= 2) return 'low';
  if (cores <= 4 || memory <= 4 || touchSmall) return 'balanced';
  return 'high';
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#160f30' : '#f4f6f9');
  window.dispatchEvent(new Event('themechange'));
}

export function applyReducedMotion(v: Preferences['reducedMotion']): void {
  const on = v === 'on' || (v === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.classList.toggle('reduce-motion', on);
}

/** Live preferences shared by the app; `updatePreferences` persists and broadcasts a 'prefschange' event. */
export const prefs: Preferences = loadPreferences();

export function updatePreferences(patch: Partial<Preferences>): void {
  Object.assign(prefs, patch);
  savePreferences(prefs);
  if (patch.theme) applyTheme(prefs.theme);
  if (patch.reducedMotion) applyReducedMotion(prefs.reducedMotion);
  window.dispatchEvent(new Event('prefschange'));
}
