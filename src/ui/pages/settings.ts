import {
  Accessibility,
  Database,
  Download,
  Gauge,
  MonitorDown,
  Moon,
  Palette,
  RefreshCw,
  Sun,
  Monitor,
  Trash2,
  Upload,
  Wrench,
  Cpu,
} from 'lucide';
import { controller } from '../../app/controller';
import { prefs, resolveQuality, updatePreferences, type Quality, type Theme } from '../../app/preferences';
import { checkForUpdate, installApp, pwa } from '../../app/pwa';
import type { Page } from '../../app/router';
import { defaultConfig } from '../../simulation/config';
import * as db from '../../storage/db';
import { MAX_BACKUP_FILE_BYTES } from '../../storage/validation';
import { button, segmented } from '../components/button';
import { confirmAction, toast } from '../components/feedback';
import { slider, toggle } from '../components/form';
import { pageHeader, panel } from '../components/layout';
import { download, h, pickFile, setText } from '../dom';

const page: Page = (root) => {
  const cleanups: (() => void)[] = [];

  // ---------- Appearance ----------
  const theme = segmented<Theme>(
    [
      { value: 'system', label: 'System', icon: Monitor },
      { value: 'dark', label: 'Dark', icon: Moon },
      { value: 'light', label: 'Light', icon: Sun },
    ],
    prefs.theme,
    (v) => updatePreferences({ theme: v }),
    'Theme',
  );
  theme.dataset.testid = 'theme';
  const appearance = panel(
    'Appearance',
    { icon: Palette },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Theme'), theme),
  );

  // ---------- Performance ----------
  const resolved = h('p', { class: 'field-hint' });
  const syncResolved = () =>
    setText(
      resolved,
      prefs.quality === 'auto'
        ? `Auto selected “${resolveQuality('auto')}” for this device (${navigator.hardwareConcurrency || '?'} cores).`
        : 'Low: 1× pixel ratio, 30 ghost cars, no scenery. Balanced: 1.5×, 120 cars. High: 2×, all cars, shadows.',
    );
  const quality = segmented<Quality>(
    [
      { value: 'auto', label: 'Auto' },
      { value: 'low', label: 'Low' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'high', label: 'High' },
    ],
    prefs.quality,
    (v) => {
      updatePreferences({ quality: v });
      syncResolved();
    },
    'Rendering quality',
  );
  syncResolved();
  const perf = panel(
    'Performance',
    { icon: Gauge },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rendering quality'), quality, resolved),
    toggle(
      'Performance overlay',
      prefs.showPerf,
      (v) => updatePreferences({ showPerf: v }),
      'FPS, simulation steps/s, worker and render time, active vehicles',
      'toggle-perf',
    ),
    toggle('Show sensor rays', prefs.showSensors, (v) => updatePreferences({ showSensors: v })),
    toggle(
      'Full screen when driving',
      prefs.maximizeDriving,
      (v) => updatePreferences({ maximizeDriving: v }),
      'Manual driving opens in full screen. Press F to toggle, Esc to leave.',
      'toggle-maximize',
    ),
  );

  // ---------- Physics ----------
  const p = controller.config.physics;
  const setPhysics = (k: keyof typeof p, v: number) => {
    const c = structuredClone(controller.config);
    c.physics[k] = v;
    controller.setConfig(c);
  };
  const physics = panel(
    'Vehicle physics',
    { icon: Wrench, subtitle: 'applies to the next simulation' },
    slider({
      label: 'Top speed',
      min: 100,
      max: 600,
      step: 10,
      value: p.maxSpeed,
      format: (v) => `${Math.round(v * 0.36)} km/h`,
      onInput: (v) => setPhysics('maxSpeed', v),
    }),
    slider({
      label: 'Acceleration',
      min: 50,
      max: 800,
      step: 10,
      value: p.acceleration,
      format: (v) => `${(v / 10).toFixed(0)} m/s²`,
      onInput: (v) => setPhysics('acceleration', v),
    }),
    slider({
      label: 'Braking',
      min: 100,
      max: 1500,
      step: 10,
      value: p.brakeDeceleration,
      format: (v) => `${(v / 10).toFixed(0)} m/s²`,
      onInput: (v) => setPhysics('brakeDeceleration', v),
    }),
    slider({
      label: 'Rolling friction',
      min: 0,
      max: 300,
      step: 5,
      value: p.friction,
      format: (v) => `${(v / 10).toFixed(1)} m/s²`,
      onInput: (v) => setPhysics('friction', v),
    }),
    slider({
      label: 'Steering rate',
      min: 0.5,
      max: 6,
      step: 0.1,
      value: p.steerRate,
      format: (v) => `${v.toFixed(1)} rad/s`,
      onInput: (v) => setPhysics('steerRate', v),
    }),
    slider({
      label: 'Max reverse speed',
      min: 0,
      max: 200,
      step: 5,
      value: p.maxReverseSpeed,
      format: (v) => `${Math.round(v * 0.36)} km/h`,
      onInput: (v) => setPhysics('maxReverseSpeed', v),
    }),
    button({
      label: 'Restore physics defaults',
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        const c = structuredClone(controller.config);
        c.physics = defaultConfig().physics;
        controller.setConfig(c);
        toast('Physics defaults restored. Reopen this page to see the values.', 'success');
      },
    }),
  );

  // ---------- Accessibility ----------
  const motion = segmented<'system' | 'on' | 'off'>(
    [
      { value: 'system', label: 'System' },
      { value: 'on', label: 'Reduce' },
      { value: 'off', label: 'Full' },
    ],
    prefs.reducedMotion,
    (v) => updatePreferences({ reducedMotion: v }),
    'Motion',
  );
  const a11y = panel(
    'Accessibility',
    { icon: Accessibility },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Interface motion'), motion),
    h(
      'p',
      { class: 'field-hint' },
      'All controls are keyboard accessible. Manual driving supports arrow keys, WASD and on-screen touch pedals.',
    ),
  );

  // ---------- Data ----------
  const usage = h('p', { class: 'field-hint', 'data-testid': 'storage-usage' }, 'Checking storage…');
  const corruptSlot = h('div');
  const refreshData = async () => {
    try {
      const est = await db.storageEstimate();
      const counts = await Promise.all(
        (['drivers', 'experiments', 'checkpoints', 'benchmarks'] as const).map(
          async (n) => [n, await db.getAll(n)] as const,
        ),
      );
      const text = counts.map(([n, r]) => `${r.items.length} ${n}`).join(' · ');
      setText(
        usage,
        `${text}${est ? ` · ${(est.usage / 1024 / 1024).toFixed(1)} MB used of ${(est.quota / 1024 / 1024 / 1024).toFixed(1)} GB available` : ''}`,
      );
      const corrupt = counts.filter(([, r]) => r.corrupt.length);
      corruptSlot.replaceChildren(
        ...(corrupt.length
          ? [
              h(
                'div',
                { class: 'notice notice-row' },
                h(
                  'span',
                  null,
                  `Damaged records found: ${corrupt.map(([n, r]) => `${r.corrupt.length} ${n}`).join(', ')}. They are skipped when loading.`,
                ),
                button({
                  label: 'Remove damaged records',
                  size: 'sm',
                  variant: 'danger',
                  onClick: async () => {
                    if (
                      !(await confirmAction(
                        'Remove damaged records?',
                        'Records that failed validation will be permanently deleted. Valid data is not affected.',
                        { confirmLabel: 'Remove', danger: true },
                      ))
                    )
                      return;
                    for (const [n, r] of corrupt) await db.removeCorrupt(n, r.corrupt);
                    toast('Damaged records removed.', 'success');
                    void refreshData();
                  },
                }),
              ),
            ]
          : []),
      );
    } catch (err) {
      setText(usage, (err as Error).message);
    }
  };
  const data = panel(
    'Data & backups',
    { icon: Database, subtitle: 'IndexedDB, on this device only' },
    usage,
    corruptSlot,
    h(
      'div',
      { class: 'toolbar' },
      button({
        label: 'Export backup',
        icon: Download,
        testId: 'export-backup',
        onClick: async () => {
          try {
            download(
              `autopilot-lab-backup-${new Date().toISOString().slice(0, 10)}.json`,
              await db.exportBackup(),
            );
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        },
      }),
      button({
        label: 'Import backup',
        icon: Upload,
        testId: 'import-backup',
        onClick: async () => {
          try {
            const raw = await pickFile('application/json,.json', MAX_BACKUP_FILE_BYTES);
            if (raw === null) return;
            const s = await db.importBackup(raw);
            toast(
              `Imported ${s.imported} record(s)${s.renamed ? `, ${s.renamed} as copies of existing ids` : ''}${s.rejected ? `, ${s.rejected} invalid record(s) skipped` : ''}.`,
              s.rejected ? 'warning' : 'success',
            );
            void refreshData();
          } catch (err) {
            toast(`Import failed: ${(err as Error).message}`, 'error');
          }
        },
      }),
      button({
        label: 'Delete all data',
        icon: Trash2,
        variant: 'danger',
        testId: 'clear-data',
        onClick: async () => {
          const ok = await confirmAction(
            'Delete all data?',
            'Every saved driver, experiment, checkpoint and benchmark on this device will be permanently deleted. Export a backup first if you want to keep anything.',
            { confirmLabel: 'Delete everything', danger: true, typeToConfirm: 'DELETE' },
          );
          if (!ok) return;
          if (controller.hasSession) await controller.stop();
          await db.clearAll().catch((e: Error) => toast(e.message, 'error'));
          toast('All data deleted.', 'success');
          void refreshData();
        },
      }),
    ),
  );

  // ---------- App ----------
  const installBtn = button({
    label: 'Install app',
    icon: MonitorDown,
    variant: 'primary',
    testId: 'install-app',
    onClick: () => void installApp(),
  });
  const swInfo = h('p', { class: 'field-hint', 'data-testid': 'sw-status' });
  const syncPwa = () => {
    installBtn.hidden = pwa.installed;
    setText(
      swInfo,
      `${pwa.installed ? 'Running as an installed app. ' : pwa.installable ? 'Ready to install. ' : ''}Offline support: ${
        {
          unsupported: 'not supported by this browser',
          dev: 'disabled in development builds',
          registering: 'starting…',
          active: 'active — the app works offline',
          'update-ready': 'update downloaded, reload to apply',
          error: 'failed to start',
        }[pwa.serviceWorker]
      }.`,
    );
  };
  window.addEventListener('pwachange', syncPwa);
  cleanups.push(() => window.removeEventListener('pwachange', syncPwa));
  syncPwa();
  const app = panel(
    'Application',
    { icon: Cpu },
    swInfo,
    h(
      'div',
      { class: 'toolbar' },
      installBtn,
      button({ label: 'Check for updates', icon: RefreshCw, onClick: () => void checkForUpdate() }),
    ),
    h(
      'p',
      { class: 'field-hint' },
      `Autopilot Lab ${__APP_VERSION__} · database schema v${db.DB_VERSION}. Simulation results are for research and education only and say nothing about real-world driving safety.`,
    ),
  );

  root.append(
    pageHeader('Settings', 'Appearance, performance, physics and data management.'),
    h(
      'div',
      { class: 'grid grid-2' },
      h('div', { class: 'stack' }, appearance, perf, a11y, app),
      h('div', { class: 'stack' }, physics, data),
    ),
  );
  void refreshData();
  return () => cleanups.forEach((f) => f());
};

export default page;
