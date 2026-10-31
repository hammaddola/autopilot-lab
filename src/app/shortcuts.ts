import { openDialog } from '../ui/components/feedback';
import { h } from '../ui/dom';
import { SPEEDS } from '../workers/protocol';
import { controller } from './controller';
import { isMaximized, setMaximized } from './driveMode';

const HELP: [string[], string][] = [
  [['Space'], 'Pause / resume'],
  [['N'], 'Step one frame (while paused)'],
  [['R'], 'Restart run (manual and test modes)'],
  [['1', '2', '3', '4'], 'Speed 1× / 2× / 5× / 10×'],
  [['F'], 'Full screen on / off'],
  [['Esc'], 'Leave full screen'],
  [['W', 'A', 'S', 'D'], 'Drive (manual mode; arrow keys also work)'],
  [['?'], 'Show this help'],
];

export function showShortcuts(): Promise<null> {
  const rows = HELP.map(([keys, what]) =>
    h('tr', null, h('td', null, ...keys.map((k) => h('kbd', null, k))), h('td', null, what)),
  );
  return openDialog(
    'Keyboard shortcuts',
    h('table', { class: 'table shortcuts' }, h('tbody', null, ...rows)),
    [{ label: 'Close', value: null, variant: 'primary' }],
    null,
  );
}

/** Global simulation shortcuts. Ignored while typing, with modifiers, or when a dialog is open. */
export function initShortcuts(): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
    // Space already activates a focused button or link.
    if (e.code === 'Space' && t.closest('button, a, [role="radio"]')) return;
    if (e.key === 'Escape' && isMaximized()) {
      setMaximized(false);
      return;
    }
    if (e.code === 'KeyF') {
      setMaximized(!isMaximized());
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      void showShortcuts();
      return;
    }
    if (!controller.hasSession) return;
    const speed = SPEEDS[Number(e.key) - 1];
    if (e.code === 'Space') {
      e.preventDefault();
      if (controller.status === 'running') controller.pause();
      else if (controller.status === 'paused') controller.play();
    } else if (e.code === 'KeyN' && controller.status === 'paused') controller.step();
    else if (e.code === 'KeyR' && controller.mode !== 'train') void controller.restart();
    else if (speed !== undefined && /^[1-4]$/.test(e.key)) controller.setSpeed(speed);
  });
}
