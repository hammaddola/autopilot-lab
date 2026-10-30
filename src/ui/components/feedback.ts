import { CircleCheck, Info, TriangleAlert, X } from 'lucide';
import { h, icon } from '../dom';
import { button } from './button';
import { textField } from './form';

// ---------- Toast notifications ----------

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: TriangleAlert };

let region: HTMLElement | null = null;

export function toast(
  message: string,
  kind: ToastKind = 'info',
  action?: { label: string; run: () => void },
  ms = 5000,
): void {
  if (!region) {
    region = h('div', { class: 'toast-region', role: 'region', 'aria-label': 'Notifications' });
    document.body.append(region);
  }
  const el = h(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(ICONS[kind], 18),
    h('p', { class: 'toast-msg' }, message),
  );
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  if (action)
    el.append(
      button({
        label: action.label,
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          action.run();
          close();
        },
      }),
    );
  el.append(
    button({ label: 'Dismiss', icon: X, iconOnly: true, variant: 'ghost', size: 'sm', onClick: close }),
  );
  region.append(el);
  if (ms > 0 && kind !== 'error') setTimeout(close, ms);
}

// ---------- Dialogs ----------

/** Generic modal built on <dialog> (native focus trap, Esc to close). Resolves with the chosen value. */
export function openDialog<T>(
  title: string,
  body: Node,
  actions: {
    label: string;
    value: T;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    validate?: () => boolean;
  }[],
  cancelValue: T,
): Promise<T> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' });
    const footer = h('div', { class: 'dialog-actions' });
    let result = cancelValue;
    for (const a of actions) {
      footer.append(
        button({
          label: a.label,
          variant: a.variant ?? 'secondary',
          testId: `dialog-${a.label.toLowerCase().replace(/\s+/g, '-')}`,
          onClick: () => {
            if (a.validate && !a.validate()) return;
            result = a.value;
            dlg.close();
          },
        }),
      );
    }
    dlg.append(
      h('h2', { id: 'dlg-title', class: 'dialog-title' }, title),
      h('div', { class: 'dialog-body' }, body),
      footer,
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Confirmation for destructive actions. With `typeToConfirm`, the user must type the word to proceed. */
export async function confirmAction(
  title: string,
  message: string,
  o: { confirmLabel?: string; danger?: boolean; typeToConfirm?: string } = {},
): Promise<boolean> {
  const body = h('div', null, h('p', null, message));
  let field: ReturnType<typeof textField> | null = null;
  if (o.typeToConfirm) {
    field = textField(`Type "${o.typeToConfirm}" to confirm`, '', { maxLength: 40 });
    body.append(field);
  }
  return openDialog(
    title,
    body,
    [
      { label: 'Cancel', value: false, variant: 'ghost' },
      {
        label: o.confirmLabel ?? 'Confirm',
        value: true,
        variant: o.danger ? 'danger' : 'primary',
        validate: () => !field || field.input.value.trim() === o.typeToConfirm,
      },
    ],
    false,
  );
}

/** Name + description prompt (drivers, experiments). Returns null when cancelled. */
export async function promptDetails(
  title: string,
  name: string,
  description: string | null,
  confirmLabel = 'Save',
): Promise<{ name: string; description: string } | null> {
  const n = textField('Name', name, { maxLength: 80 });
  const d =
    description === null ? null : textField('Description', description, { maxLength: 500, multiline: true });
  const ok = await openDialog(
    title,
    h('div', { class: 'stack' }, n, d),
    [
      { label: 'Cancel', value: false, variant: 'ghost' },
      {
        label: confirmLabel,
        value: true,
        variant: 'primary',
        validate: () => n.input.value.trim().length > 0,
      },
    ],
    false,
  );
  return ok ? { name: n.input.value.trim(), description: d?.input.value.trim() ?? '' } : null;
}

// ---------- Status indicator ----------

export type StatusTone = 'idle' | 'running' | 'paused' | 'warning' | 'error' | 'done';

export function statusPill(
  label: string,
  tone: StatusTone,
): HTMLElement & { set(label: string, tone: StatusTone): void } {
  const text = h('span', null, label);
  const el = h(
    'span',
    { class: `status status-${tone}`, role: 'status' },
    h('span', { class: 'status-dot' }),
    text,
  ) as HTMLElement & {
    set(label: string, tone: StatusTone): void;
  };
  el.set = (l, t) => {
    if (text.textContent !== l) text.textContent = l;
    el.className = `status status-${t}`;
  };
  return el;
}
