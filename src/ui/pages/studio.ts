import { Car, FlaskConical, Gamepad2, Map as MapIcon, Play, Radar, Shuffle, Trophy } from 'lucide';
import { controller } from '../../app/controller';
import { prefs, updatePreferences } from '../../app/preferences';
import type { Page } from '../../app/router';
import {
  PRESETS,
  presetEnv,
  sanitizeConfig,
  type EnvPreset,
  type SimConfig,
  type SimMode,
  type TrafficPattern,
} from '../../simulation/config';
import { HIT_LABELS, rayOffset } from '../../simulation/sensor';
import * as db from '../../storage/db';
import type { DriverRecord } from '../../storage/validation';
import { button, segmented } from '../components/button';
import { confirmAction, toast } from '../components/feedback';
import { numberField, select, slider, toggle } from '../components/form';
import { emptyState, pageHeader, panel, table } from '../components/layout';
import { liveStatus, transport } from '../components/live';
import { viewport } from '../components/viewport';
import { fmt, h, setText } from '../dom';

/** Starts a test run with the given drivers; shared with the Driver Library. */
export async function startTest(drivers: DriverRecord[]): Promise<void> {
  if (!drivers.length) {
    toast('Select at least one driver to test.', 'warning');
    return;
  }
  await controller.start('test', { drivers });
}

const page: Page = (root) => {
  const cleanups: (() => void)[] = [];
  let draft: SimConfig = structuredClone(controller.config);

  // ---------- Header & mode ----------
  const status = liveStatus();
  cleanups.push(status.destroy);
  let drivers: DriverRecord[] = [];
  const selected = new Set<string>();

  const switchMode = async (m: SimMode) => {
    if (controller.hasSession && controller.mode === 'train' && m !== 'train') {
      const ok = await confirmAction(
        'Leave training?',
        'Training will stop. A checkpoint is saved first so you can resume it from the AI Training Lab.',
        { confirmLabel: 'Switch mode' },
      );
      if (!ok) return modeSel.set(controller.mode);
    }
    if (m === 'test') {
      const chosen = drivers.filter((d) => selected.has(d.id));
      if (!chosen.length) {
        await controller.stop();
        controller.mode = 'test';
        toast('Choose one or more drivers in the Test drivers panel, then press Run test.', 'info');
        sync();
        return;
      }
      await startTest(chosen);
    } else await controller.start(m);
  };
  const modeSel = segmented<SimMode>(
    [
      { value: 'train', label: 'Train AI', icon: FlaskConical },
      { value: 'test', label: 'Test driver', icon: Trophy },
      { value: 'manual', label: 'Manual', icon: Gamepad2 },
    ],
    controller.mode,
    (m) => void switchMode(m),
    'Simulation mode',
  );
  modeSel.dataset.testid = 'mode';
  const header = pageHeader(
    'Simulation Studio',
    'Configure scenarios and sensors, then watch, test or drive.',
    status.el,
  );

  // ---------- Viewport ----------
  const vp = viewport({ height: 'min(68vh, 640px)' });
  const tr = transport();
  cleanups.push(vp.destroy, tr.destroy);
  const startBtn = button({
    label: 'Start',
    icon: Play,
    variant: 'primary',
    testId: 'studio-start',
    onClick: () => void switchMode(controller.mode),
  });
  const stage = h(
    'div',
    { class: 'stage' },
    h('div', { class: 'stage-bar' }, modeSel, tr.el, startBtn),
    vp.el,
  );

  // ---------- Environment ----------
  const dirtyNote = h(
    'p',
    { class: 'field-hint', hidden: true },
    'Changes apply when the simulation restarts.',
  );
  const markDirty = () => (dirtyNote.hidden = false);
  const envFields = h('div', { class: 'stack' });
  const buildEnvFields = () => {
    const e = draft.env;
    const seedField = numberField('Scenario seed', e.seed, {
      min: 0,
      max: 2 ** 31 - 1,
      onChange: (v) => ((draft.env.seed = v), markDirty()),
      testId: 'seed',
    });
    const shuffleBtn = button({
      label: 'Random seed',
      icon: Shuffle,
      iconOnly: true,
      onClick: () => {
        draft.env.seed = Math.floor(Math.random() * 1e9);
        seedField.input.value = String(draft.env.seed);
        markDirty();
      },
    });
    envFields.replaceChildren(
      select<EnvPreset>(
        'Environment',
        (Object.keys(PRESETS) as EnvPreset[]).map((k) => ({ value: k, label: PRESETS[k].label })),
        e.preset,
        (v) => {
          draft.env = presetEnv(v, draft.env.seed);
          buildEnvFields();
          markDirty();
        },
        'env-preset',
      ),
      h('p', { class: 'field-hint' }, PRESETS[e.preset].description),
      h('div', { class: 'seed-row' }, seedField, shuffleBtn),
      slider({
        label: 'Lanes',
        min: 2,
        max: 6,
        step: 1,
        value: e.laneCount,
        onInput: (v) => ((draft.env.laneCount = v), markDirty()),
      }),
      slider({
        label: 'Lane width',
        min: 44,
        max: 90,
        step: 1,
        value: e.laneWidth,
        format: (v) => `${(v / 10).toFixed(1)} m`,
        onInput: (v) => ((draft.env.laneWidth = v), markDirty()),
      }),
      slider({
        label: 'Traffic density',
        min: 0,
        max: 1,
        step: 0.05,
        value: e.trafficDensity,
        format: fmt.pct,
        onInput: (v) => ((draft.env.trafficDensity = v), markDirty()),
      }),
      slider({
        label: 'Traffic speed',
        min: 0.2,
        max: 0.9,
        step: 0.05,
        value: e.trafficSpeed,
        format: (v) => `${fmt.pct(v)} of max`,
        onInput: (v) => ((draft.env.trafficSpeed = v), markDirty()),
      }),
      slider({
        label: 'Obstacle density',
        min: 0,
        max: 1,
        step: 0.05,
        value: e.obstacleDensity,
        format: fmt.pct,
        hint: 'Obstacles use the right-hand lanes; traffic keeps to the left ones.',
        onInput: (v) => ((draft.env.obstacleDensity = v), markDirty()),
      }),
      select<TrafficPattern>(
        'Traffic pattern',
        [
          { value: 'random', label: 'Random' },
          { value: 'staggered', label: 'Staggered' },
          { value: 'platoon', label: 'Platoons' },
        ],
        e.pattern,
        (v) => ((draft.env.pattern = v), markDirty()),
      ),
    );
  };
  buildEnvFields();

  const apply = async () => {
    const sensorsChanged = JSON.stringify(draft.sensors) !== JSON.stringify(controller.config.sensors);
    if (controller.mode === 'train' && controller.hasSession && sensorsChanged) {
      const ok = await confirmAction(
        'Restart training?',
        'Changing the sensor rig changes the number of network inputs, so training must start again from generation 0. The current run is checkpointed first.',
        { confirmLabel: 'Apply and restart' },
      );
      if (!ok) return;
    }
    controller.setConfig(sanitizeConfig(draft));
    draft = structuredClone(controller.config);
    dirtyNote.hidden = true;
    if (controller.hasSession) await controller.restart();
    else toast('Settings saved. They will be used when you start a simulation.', 'success');
  };
  const applyBtn = button({
    label: 'Apply & restart',
    variant: 'primary',
    onClick: () => void apply(),
    testId: 'apply-env',
  });
  const envPanel = panel('Environment', { icon: MapIcon }, envFields, dirtyNote, applyBtn);

  // ---------- Sensors ----------
  const s = draft.sensors;
  const sensorPanel = panel(
    'Sensors',
    { icon: Radar },
    slider({
      label: 'Rays',
      min: 1,
      max: 16,
      step: 1,
      value: s.rayCount,
      onInput: (v) => ((draft.sensors.rayCount = v), markDirty()),
      testId: 'rays',
    }),
    slider({
      label: 'Range',
      min: 50,
      max: 500,
      step: 10,
      value: s.range,
      format: (v) => `${v} u · ${(v / 10).toFixed(0)} m`,
      onInput: (v) => ((draft.sensors.range = v), markDirty()),
    }),
    slider({
      label: 'Field of view',
      min: 10,
      max: 300,
      step: 2,
      value: s.fov,
      format: (v) => `${v}°`,
      onInput: (v) => ((draft.sensors.fov = v), markDirty()),
    }),
    toggle(
      'Show sensor rays',
      prefs.showSensors,
      (v) => updatePreferences({ showSensors: v }),
      undefined,
      'toggle-sensors',
    ),
    h(
      'p',
      { class: 'field-hint' },
      'Rays + speed form the network inputs. Saved drivers always use the rig they were trained with.',
    ),
  );

  // ---------- Live sensor readout ----------
  const readoutBody = h('tbody');
  const readout = panel(
    'Sensor readings',
    { icon: Radar, subtitle: 'focus car' },
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table table-compact', 'data-testid': 'sensor-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ...['Ray', 'Angle', 'Reading', 'Distance', 'Detected'].map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        readoutBody,
      ),
    ),
  );
  const decision = h('p', { class: 'decision', 'data-testid': 'decision' });
  readout.body.append(decision);
  let lastReadout = 0;
  const updateReadout = () => {
    const now = performance.now();
    if (now - lastReadout < 150) return;
    lastReadout = now;
    const f = controller.frame?.focus;
    if (!f) {
      readoutBody.replaceChildren(h('tr', null, h('td', { colspan: 5, class: 'muted' }, 'No active car.')));
      setText(decision, '');
      return;
    }
    if (readoutBody.childElementCount !== f.readings.length || readoutBody.querySelector('td[colspan]')) {
      readoutBody.replaceChildren(
        ...f.readings.map(() => h('tr', null, h('td'), h('td'), h('td'), h('td'), h('td'))),
      );
    }
    f.readings.forEach((r, i) => {
      const cells = readoutBody.children[i]!.children;
      const dist = f.hitKinds[i] ? (1 - r) * f.sensors.range : null;
      setText(cells[0]!, `S${i + 1}`);
      setText(cells[1]!, `${((rayOffset(i, f.sensors) * 180) / Math.PI).toFixed(0)}°`);
      setText(cells[2]!, r.toFixed(3));
      setText(cells[3]!, dist === null ? '—' : `${(dist / 10).toFixed(1)} m`);
      setText(cells[4]!, HIT_LABELS[f.hitKinds[i]!] ?? '—');
    });
    const c = f.controls;
    const parts = [
      c.throttle > 0 ? 'Throttle' : null,
      c.brake > 0 ? (f.speed > 1 ? 'Brake' : 'Reverse') : null,
      c.steer < 0 ? 'Steer left' : c.steer > 0 ? 'Steer right' : null,
    ].filter(Boolean);
    setText(decision, `Decision: ${parts.length ? parts.join(' + ') : 'Coast'}`);
  };
  cleanups.push(controller.on('frame', updateReadout));

  // ---------- Test drivers ----------
  const driverList = h('div', { class: 'check-list', 'data-testid': 'test-driver-list' });
  const results = h('div');
  const focusSel = h('div');
  const runTest = button({
    label: 'Run test',
    icon: Trophy,
    variant: 'primary',
    testId: 'run-test',
    onClick: () => void startTest(drivers.filter((d) => selected.has(d.id))),
  });
  const testPanel = panel(
    'Test drivers',
    { icon: Trophy, subtitle: 'same scenario, same traffic' },
    driverList,
    runTest,
    focusSel,
    results,
  );
  const renderDrivers = () => {
    if (!drivers.length) {
      driverList.replaceChildren(
        emptyState(
          Car,
          'No saved drivers',
          'Train a population and save the best driver, or import one in the Driver Library.',
        ),
      );
      runTest.disabled = true;
      return;
    }
    runTest.disabled = false;
    driverList.replaceChildren(
      ...drivers.map((d) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(d.id) });
        cb.addEventListener('change', () => (cb.checked ? selected.add(d.id) : selected.delete(d.id)));
        return h(
          'label',
          { class: 'check-item' },
          cb,
          h('span', null, d.name),
          h('span', { class: 'muted small' }, `gen ${d.generation} · F ${fmt.num(d.fitness)}`),
        );
      }),
    );
  };
  const renderResults = () => {
    const r = controller.testResults;
    if (controller.mode === 'test' && controller.testDrivers.length > 1 && controller.hasSession) {
      focusSel.replaceChildren(
        select(
          'Follow driver',
          [
            { value: '-1', label: 'Leader (auto)' },
            ...controller.testDrivers.map((d, i) => ({ value: String(i), label: d.name })),
          ],
          '-1',
          (v) => controller.setFocus(Number(v)),
        ),
      );
    } else focusSel.replaceChildren();
    if (!r || controller.mode !== 'test') return results.replaceChildren();
    results.replaceChildren(
      h('h3', { class: 'subhead' }, 'Results'),
      table(
        ['Driver', 'Outcome', 'Distance', 'Time', 'Avg speed', 'Fitness'],
        [...r]
          .sort((a, b) => b.distance - a.distance)
          .map((x) => [
            x.driverName,
            x.status,
            fmt.dist(x.distance),
            `${x.time.toFixed(1)} s`,
            `${fmt.int(x.avgSpeed * 0.36)} km/h`,
            fmt.num(x.fitness),
          ]),
        'test-results',
      ),
      h('p', { class: 'field-hint' }, 'Saved to benchmark history (Analytics).'),
    );
  };
  cleanups.push(controller.on('results', renderResults), controller.on('session', renderResults));

  const loadDrivers = async () => {
    try {
      drivers = (await db.getAll('drivers')).items.sort((a, b) => b.fitness - a.fitness);
      // Default selection: the best saved driver.
      if (!selected.size && drivers[0]) selected.add(drivers[0].id);
      for (const d of controller.testDrivers) selected.add(d.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    renderDrivers();
  };

  // ---------- Manual help ----------
  const manualPanel = panel(
    'Manual driving',
    { icon: Gamepad2 },
    h(
      'ul',
      { class: 'key-list' },
      h('li', null, h('kbd', null, '↑'), ' / ', h('kbd', null, 'W'), ' throttle'),
      h('li', null, h('kbd', null, '↓'), ' / ', h('kbd', null, 'S'), ' brake, reverse when stopped'),
      h(
        'li',
        null,
        h('kbd', null, '←'),
        h('kbd', null, '→'),
        ' / ',
        h('kbd', null, 'A'),
        h('kbd', null, 'D'),
        ' steer',
      ),
      h('li', null, h('kbd', null, 'R'), ' restart after a collision'),
    ),
    h('p', { class: 'field-hint' }, 'On touch screens, use the on-screen pedals and steering buttons.'),
  );

  const side = h('div', { class: 'side stack' }, testPanel, manualPanel, readout, envPanel, sensorPanel);
  root.append(header, h('div', { class: 'grid studio-grid' }, stage, side));

  const sync = () => {
    modeSel.set(controller.mode);
    testPanel.hidden = controller.mode !== 'test';
    manualPanel.hidden = controller.mode !== 'manual';
    readout.hidden = !controller.hasSession;
    startBtn.hidden = controller.hasSession || controller.mode === 'test';
    renderResults();
  };
  cleanups.push(controller.on('session', sync), controller.on('status', sync));
  sync();
  void loadDrivers();

  return () => cleanups.forEach((f) => f());
};

export default page;
