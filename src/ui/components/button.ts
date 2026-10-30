import type { IconNode } from 'lucide';
import { h, icon } from '../dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  label: string;
  icon?: IconNode;
  variant?: ButtonVariant;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  /** Hide the label visually (icon-only button); the label stays as the accessible name. */
  iconOnly?: boolean;
  size?: 'sm' | 'md';
  testId?: string;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  const b = h(
    'button',
    {
      type: 'button',
      class: `btn btn-${o.variant ?? 'secondary'}${o.size === 'sm' ? ' btn-sm' : ''}${o.iconOnly ? ' btn-icon' : ''}`,
      title: o.title ?? (o.iconOnly ? o.label : undefined),
      'aria-label': o.iconOnly ? o.label : undefined,
      'data-testid': o.testId,
    },
    o.icon ? icon(o.icon) : null,
    o.iconOnly ? null : h('span', null, o.label),
  );
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Updates a button's icon and label in place (e.g. Pause ↔ Resume). */
export function setButton(b: HTMLButtonElement, label: string, ico?: IconNode): void {
  const iconOnly = b.classList.contains('btn-icon');
  b.replaceChildren(...(ico ? [icon(ico)] : []), ...(iconOnly ? [] : [h('span', null, label)]));
  if (iconOnly) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
}

/** Segmented control (radio group semantics). */
export function segmented<T extends string | number>(
  options: { value: T; label: string; icon?: IconNode }[],
  value: T,
  onChange: (v: T) => void,
  label: string,
): HTMLElement & { set(v: T): void } {
  const group = h('div', {
    class: 'segmented',
    role: 'radiogroup',
    'aria-label': label,
  }) as unknown as HTMLElement & { set(v: T): void };
  const buttons = options.map((o) => {
    const b = h(
      'button',
      { type: 'button', role: 'radio', class: 'segment', 'data-value': String(o.value) },
      o.icon ? icon(o.icon) : null,
      h('span', null, o.label),
    );
    b.addEventListener('click', () => {
      group.set(o.value);
      onChange(o.value);
    });
    return b;
  });
  group.append(...buttons);
  group.set = (v: T) =>
    buttons.forEach((b, i) => {
      const on = options[i]!.value === v;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
    });
  group.set(value);
  return group;
}
