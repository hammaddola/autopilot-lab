import { Copy, Download, Eye, LibraryBig, Pencil, Play, Trash2, Upload } from 'lucide';
import { navigate } from '../../app/nav';
import type { Page } from '../../app/router';
import { deserializeBrain, genomeLength } from '../../ai/network';
import { PRESETS } from '../../simulation/config';
import * as db from '../../storage/db';
import {
  DRIVER_FILE_FORMAT,
  MAX_DRIVER_FILE_BYTES,
  newId,
  parseDriverFile,
  type DriverRecord,
} from '../../storage/validation';
import { button } from '../components/button';
import { confirmAction, openDialog, promptDetails, toast } from '../components/feedback';
import { emptyState, pageHeader } from '../components/layout';
import { download, fmt, h, pickFile, slug } from '../dom';
import { NetworkView } from '../render/networkView';
import { startTest } from './studio';

export function driverFileJson(d: DriverRecord): string {
  return JSON.stringify(
    {
      format: DRIVER_FILE_FORMAT,
      schemaVersion: d.schemaVersion,
      exportedAt: new Date().toISOString(),
      driver: d,
    },
    null,
    2,
  );
}

const page: Page = (root) => {
  let drivers: DriverRecord[] = [];
  const list = h('div', { class: 'driver-grid', 'data-testid': 'driver-list' });

  const importDriver = async () => {
    try {
      const raw = await pickFile('application/json,.json', MAX_DRIVER_FILE_BYTES);
      if (raw === null) return;
      const d = parseDriverFile(raw);
      const exists = drivers.some((x) => x.id === d.id);
      // Never overwrite: an imported driver with an existing id gets a new id.
      const rec: DriverRecord = {
        ...d,
        id: exists ? newId() : d.id,
        source: 'import',
        updatedAt: Date.now(),
      };
      await db.add('drivers', rec);
      toast(
        `Imported "${rec.name}"${exists ? ' as a copy (a driver with the same id already exists)' : ''}.`,
        'success',
      );
      await load();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error');
    }
  };

  const preview = (d: DriverRecord) => {
    const view = new NetworkView(320);
    view.set(deserializeBrain(d.brain), null);
    void openDialog(
      `${d.name} · network`,
      h(
        'div',
        { class: 'stack' },
        view.el,
        h(
          'p',
          { class: 'small muted' },
          `Layers ${d.brain.layers.join(' → ')} · ${genomeLength(d.brain.layers)} parameters · ${d.sensors.rayCount} rays, ${d.sensors.range} u range, ${d.sensors.fov}° FOV`,
        ),
      ),
      [{ label: 'Close', value: true }],
      true,
    ).then(() => view.destroy());
  };

  const card = (d: DriverRecord) => {
    const tc = d.trainingConfig;
    return h(
      'article',
      { class: 'driver-card', 'data-testid': 'driver-card' },
      h(
        'header',
        { class: 'driver-head' },
        h(
          'div',
          null,
          h('h3', { class: 'driver-name' }, d.name),
          h(
            'p',
            { class: 'small muted' },
            `v${d.version} · schema ${d.schemaVersion} · ${d.source} · ${fmt.date(d.createdAt)}`,
          ),
        ),
      ),
      d.description ? h('p', { class: 'driver-desc' }, d.description) : null,
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Generation'),
        h('dd', null, String(d.generation)),
        h('dt', null, 'Fitness'),
        h('dd', null, fmt.num(d.fitness)),
        h('dt', null, 'Best distance'),
        h('dd', null, fmt.dist(d.bestDistance)),
        h('dt', null, 'Network'),
        h('dd', null, d.brain.layers.join('-')),
        h('dt', null, 'Trained on'),
        h('dd', null, `${PRESETS[tc.env.preset].label} #${tc.env.seed}`),
        h('dt', null, 'Population'),
        h('dd', null, `${tc.genetic.populationSize} · μ ${tc.genetic.mutationRate}`),
      ),
      h(
        'div',
        { class: 'driver-actions' },
        button({
          label: 'Test',
          icon: Play,
          size: 'sm',
          variant: 'primary',
          onClick: () => void startTest([d]).then(() => navigate('studio')),
        }),
        button({
          label: 'Preview network',
          icon: Eye,
          iconOnly: true,
          size: 'sm',
          onClick: () => preview(d),
        }),
        button({
          label: 'Edit details',
          icon: Pencil,
          iconOnly: true,
          size: 'sm',
          onClick: async () => {
            const r = await promptDetails('Edit driver', d.name, d.description);
            if (!r) return;
            await db
              .put('drivers', { ...d, ...r, version: d.version + 1, updatedAt: Date.now() })
              .catch((e: Error) => toast(e.message, 'error'));
            await load();
          },
        }),
        button({
          label: 'Duplicate',
          icon: Copy,
          iconOnly: true,
          size: 'sm',
          onClick: async () => {
            const now = Date.now();
            await db
              .add('drivers', {
                ...structuredClone(d),
                id: newId(),
                name: `${d.name} (copy)`.slice(0, 80),
                version: 1,
                createdAt: now,
                updatedAt: now,
                source: 'duplicate',
              })
              .catch((e: Error) => toast(e.message, 'error'));
            await load();
          },
        }),
        button({
          label: 'Export JSON',
          icon: Download,
          iconOnly: true,
          size: 'sm',
          onClick: () => download(`${slug(d.name)}.driver.json`, driverFileJson(d)),
        }),
        button({
          label: 'Delete',
          icon: Trash2,
          iconOnly: true,
          size: 'sm',
          variant: 'ghost',
          onClick: async () => {
            if (
              !(await confirmAction(
                'Delete driver?',
                `"${d.name}" will be permanently deleted. Export it first if you may need it again.`,
                { confirmLabel: 'Delete', danger: true },
              ))
            )
              return;
            await db.remove('drivers', d.id).catch((e: Error) => toast(e.message, 'error'));
            await load();
          },
        }),
      ),
    );
  };

  async function load(): Promise<void> {
    try {
      const res = await db.getAll('drivers');
      drivers = res.items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (res.corrupt.length)
        toast(
          `${res.corrupt.length} damaged driver record(s) were skipped. Remove them in Settings → Data.`,
          'warning',
        );
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    list.replaceChildren(
      ...(drivers.length
        ? drivers.map(card)
        : [
            emptyState(
              LibraryBig,
              'No drivers saved',
              'Save the best driver from the AI Training Lab, or import a driver JSON file.',
              button({
                label: 'Go to Training Lab',
                variant: 'primary',
                onClick: () => navigate('training'),
              }),
            ),
          ]),
    );
  }

  root.append(
    pageHeader(
      'Driver Library',
      'Saved AI drivers with their brains, sensor rigs and training configuration.',
      button({
        label: 'Compare top drivers',
        icon: Play,
        title: 'Test up to 6 drivers together on the current Studio scenario',
        onClick: () =>
          drivers.length
            ? void startTest(drivers.slice(0, 6)).then(() => navigate('studio'))
            : toast('No saved drivers to compare yet.', 'info'),
      }),
      button({
        label: 'Import driver',
        icon: Upload,
        variant: 'primary',
        onClick: () => void importDriver(),
        testId: 'import-driver',
      }),
    ),
    list,
  );
  void load();
  return () => {};
};

export default page;
