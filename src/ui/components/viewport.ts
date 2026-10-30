import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from 'lucide';
import { controller } from '../../app/controller';
import { prefs, resolveQuality } from '../../app/preferences';
import { UNIT_TO_KMH } from '../../simulation/config';
import { HIT_LABELS } from '../../simulation/sensor';
import { fmt, h, icon, setText } from '../dom';
import { SimRenderer } from '../render/renderer';
import { button } from './button';

const MODE_LABEL = { train: 'Training', test: 'Testing', manual: 'Manual' } as const;
const STATUS_LABEL: Record<string, string> = {
  alive: 'Driving',
  crashed: 'Crashed',
  stalled: 'Stalled',
  finished: 'Finished',
  timeout: 'Time limit',
};

export interface Viewport {
  el: HTMLElement;
  destroy(): void;
}

/**
 * Simulation canvas with a heads-up display, optional performance overlay and — in manual mode — keyboard
 * (arrows / WASD) and on-screen touch pedals. Several pages embed it; all share the one controller.
 */
export function viewport(o: { height?: string; compact?: boolean } = {}): Viewport {
  const canvas = h('canvas', {
    class: 'sim-canvas',
    'aria-label': 'Top-down driving simulation',
    role: 'img',
    'data-testid': 'sim-canvas',
  });
  const renderer = new SimRenderer(canvas);

  const hudMode = h('span', { class: 'hud-chip' });
  const hudSpeed = h('span', { class: 'hud-big', 'data-testid': 'hud-speed' }, '0');
  const hudDist = h('span', { class: 'hud-chip' });
  const hudStatus = h('span', { class: 'hud-chip' });
  const hud = h(
    'div',
    { class: 'hud' },
    h('div', { class: 'hud-row' }, hudMode, hudStatus),
    h('div', { class: 'hud-speed' }, hudSpeed, h('span', { class: 'hud-unit' }, 'km/h')),
    hudDist,
  );
  const perf = h('div', { class: 'perf', 'data-testid': 'perf-overlay', 'aria-live': 'off' });
  const banner = h('div', {
    class: 'sim-banner',
    hidden: true,
    role: 'alert',
    'data-testid': 'crash-banner',
  });
  const idle = h('div', { class: 'sim-idle' }, 'No simulation running. Choose a mode to start.');

  // ---------- Manual driving input ----------
  const keys = new Set<string>();
  const touch = { up: false, down: false, left: false, right: false };
  const sendInput = () => {
    const up = touch.up || keys.has('ArrowUp') || keys.has('KeyW');
    const down = touch.down || keys.has('ArrowDown') || keys.has('KeyS');
    const left = touch.left || keys.has('ArrowLeft') || keys.has('KeyA');
    const right = touch.right || keys.has('ArrowRight') || keys.has('KeyD');
    controller.setInput(up ? 1 : 0, down ? 1 : 0, (right ? 1 : 0) - (left ? 1 : 0));
  };
  const DRIVE_KEYS = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
  ]);
  const onKey = (e: KeyboardEvent) => {
    if (controller.mode !== 'manual' || !controller.hasSession) return;
    const target = e.target as HTMLElement;
    if (target.matches('input, textarea, select')) return;
    if (!DRIVE_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(e.code);
    else keys.delete(e.code);
    sendInput();
  };
  const onBlur = () => {
    keys.clear();
    sendInput();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  const pad = (label: string, ico: Parameters<typeof icon>[0], key: keyof typeof touch, cls: string) => {
    const b = h(
      'button',
      { type: 'button', class: `pad ${cls}`, 'aria-label': label, 'data-testid': `pad-${key}` },
      icon(ico, 26),
      h('span', null, label),
    );
    const set = (v: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      if (v) b.setPointerCapture(e.pointerId);
      touch[key] = v;
      b.classList.toggle('pressed', v);
      sendInput();
    };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  const controls = h(
    'div',
    { class: 'touch-controls', hidden: true, 'data-testid': 'touch-controls' },
    h(
      'div',
      { class: 'pad-group' },
      pad('Left', ArrowLeft, 'left', 'pad-steer'),
      pad('Right', ArrowRight, 'right', 'pad-steer'),
    ),
    h(
      'div',
      { class: 'pad-group' },
      pad('Brake', ArrowDown, 'down', 'pad-brake'),
      pad('Throttle', ArrowUp, 'up', 'pad-throttle'),
    ),
  );

  const el = h(
    'div',
    { class: `viewport${o.compact ? ' compact' : ''}`, style: o.height ? `height:${o.height}` : undefined },
    canvas,
    idle,
    hud,
    perf,
    banner,
    controls,
  );

  const applyPrefs = () => {
    renderer.setQuality(resolveQuality(prefs.quality));
    renderer.showSensors = prefs.showSensors;
    perf.hidden = !prefs.showPerf;
  };
  applyPrefs();
  window.addEventListener('prefschange', applyPrefs);

  let lastHud = 0;
  const update = () => {
    const now = performance.now();
    if (now - lastHud < 100) return; // HUD at 10 Hz is plenty and keeps DOM writes low
    lastHud = now;
    const f = controller.frame;
    idle.hidden = controller.hasSession;
    hud.hidden = !f;
    controls.hidden = controller.mode !== 'manual' || !controller.hasSession;
    if (f?.focus) {
      setText(
        hudMode,
        `${MODE_LABEL[f.stats.mode]}${f.stats.mode === 'train' ? ` · Gen ${f.stats.generation}` : ''}`,
      );
      setText(hudSpeed, String(Math.round(Math.abs(f.focus.speed) * UNIT_TO_KMH)));
      setText(hudDist, `${fmt.dist(Math.max(0, f.focus.s - 100))} travelled`);
      setText(hudStatus, STATUS_LABEL[f.focus.status] ?? f.focus.status);
      hudStatus.dataset.tone =
        f.focus.status === 'alive' ? 'ok' : f.focus.status === 'crashed' ? 'bad' : 'warn';
    }
    if (controller.mode === 'manual' && controller.manualCrash) {
      banner.hidden = false;
      const cause =
        HIT_LABELS[{ border: 1, vehicle: 2, obstacle: 3 }[controller.manualCrash] ?? 0] ?? 'object';
      if (!banner.childElementCount) {
        banner.append(
          h('strong', null, 'Collision'),
          h('span', { class: 'banner-cause' }),
          button({
            label: 'Restart',
            icon: RotateCcw,
            variant: 'primary',
            size: 'sm',
            onClick: () => void controller.restart(),
          }),
        );
      }
      setText(banner.querySelector('.banner-cause')!, ` with ${cause.toLowerCase()}. Press R or Restart.`);
    } else banner.hidden = true;
    if (prefs.showPerf) {
      const p = controller.perf;
      setText(
        perf,
        `FPS ${p.fps.toFixed(0)} · render ${p.renderMs.toFixed(1)} ms · sim ${p.stepsPerSecond.toFixed(0)} steps/s · worker ${p.workerMs.toFixed(1)} ms · vehicles ${p.vehicles}`,
      );
    }
  };
  const offFrame = controller.on('frame', update);
  const offStatus = controller.on('status', () => {
    lastHud = 0;
    update();
  });
  const offSession = controller.on('session', () => {
    lastHud = 0;
    update();
  });
  const timer = setInterval(update, 500); // keeps perf/idle state fresh even without frames
  update();

  return {
    el,
    destroy() {
      renderer.destroy();
      offFrame();
      offStatus();
      offSession();
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('prefschange', applyPrefs);
      keys.clear();
    },
  };
}
