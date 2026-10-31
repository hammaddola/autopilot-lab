import { controller } from './controller';
import { prefs } from './preferences';

// Drive mode: the mounted simulation view fills the window. One flag for the whole app so the
// state survives page changes (e.g. Dashboard → Studio).
let maximized = false;
let views = 0;

export const isMaximized = (): boolean => maximized;

/** Toggles drive mode; also requests real fullscreen where the Fullscreen API allows it. */
export function setMaximized(on: boolean): void {
  if (maximized === on || (on && views === 0)) return;
  maximized = on;
  document.documentElement.classList.toggle('vp-max', on);
  // Fullscreen needs a recent user gesture; if refused, the view still fills the window.
  if (on) void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  window.dispatchEvent(new Event('viewportmax'));
}

/** Called by each mounted simulation view; returns its unmount callback. */
export function trackView(): () => void {
  views++;
  if (pending) {
    pending = false;
    setMaximized(true);
  }
  return () => {
    views--;
    // Navigated to a page without a simulation view: don't leave an empty full-screen state behind.
    setTimeout(() => views === 0 && setMaximized(false));
  };
}

// Manual driving can start before its page has mounted a view (Dashboard → "Drive manually").
let pending = false;

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setMaximized(false);
});
// Auto-maximize only when entering manual mode, so a restart after leaving full screen stays windowed.
let lastMode: string | null = null;
controller.on('session', () => {
  const mode = controller.hasSession ? controller.mode : null;
  const entering = mode === 'manual' && lastMode !== 'manual';
  lastMode = mode;
  pending = false;
  if (!mode) setMaximized(false);
  else if (entering && prefs.maximizeDriving) {
    if (views) setMaximized(true);
    else pending = true;
  }
});
