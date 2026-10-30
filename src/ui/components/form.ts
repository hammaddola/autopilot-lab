import { h, setText } from '../dom';

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  hint?: string;
  onInput?: (v: number) => void;
  testId?: string;
}

export type Slider = HTMLElement & { value: number; input: HTMLInputElement; setDisabled(d: boolean): void };

/** Labelled range input with live value readout. */
export function slider(o: SliderOptions): Slider {
  const id = nextId('sl');
  const fmtv = o.format ?? ((v: number) => String(v));
  const out = h('output', { for: id, class: 'field-value' }, fmtv(o.value));
  const input = h('input', {
    id,
    type: 'range',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
    'data-testid': o.testId,
  });
  const wrap = h(
    'div',
    { class: 'field' },
    h('div', { class: 'field-row' }, h('label', { for: id, class: 'field-label' }, o.label), out),
    input,
    o.hint ? h('p', { class: 'field-hint' }, o.hint) : null,
  ) as unknown as Slider;
  const sync = () => {
    setText(out, fmtv(Number(input.value)));
    input.style.setProperty('--fill', `${((Number(input.value) - o.min) / (o.max - o.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    sync();
    o.onInput?.(Number(input.value));
  });
  Object.defineProperty(wrap, 'value', {
    get: () => Number(input.value),
    set: (v: number) => {
      input.value = String(v);
      sync();
    },
  });
  wrap.input = input;
  wrap.setDisabled = (d) => (input.disabled = d);
  sync();
  return wrap;
}

export function select<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  testId?: string,
): HTMLElement & { select: HTMLSelectElement } {
  const id = nextId('sel');
  const sel = h('select', { id, class: 'input', 'data-testid': testId });
  for (const o of options) sel.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  sel.addEventListener('change', () => onChange(sel.value as T));
  const wrap = h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    sel,
  ) as unknown as HTMLElement & {
    select: HTMLSelectElement;
  };
  wrap.select = sel;
  return wrap;
}

export function toggle(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
  hint?: string,
  testId?: string,
): HTMLElement & { input: HTMLInputElement } {
  const id = nextId('tg');
  const input = h('input', {
    id,
    type: 'checkbox',
    role: 'switch',
    checked,
    class: 'switch',
    'data-testid': testId,
  });
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = h(
    'div',
    { class: 'field field-toggle' },
    h(
      'label',
      { for: id, class: 'field-label' },
      label,
      hint ? h('span', { class: 'field-hint' }, hint) : null,
    ),
    input,
  ) as unknown as HTMLElement & { input: HTMLInputElement };
  wrap.input = input;
  return wrap;
}

export function numberField(
  label: string,
  value: number,
  o: { min: number; max: number; step?: number; onChange: (v: number) => void; testId?: string },
): HTMLElement & { input: HTMLInputElement } {
  const id = nextId('num');
  const input = h('input', {
    id,
    type: 'number',
    class: 'input',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step ?? 1),
    value: String(value),
    inputmode: 'numeric',
    'data-testid': o.testId,
  });
  input.addEventListener('change', () => {
    const v = Math.min(o.max, Math.max(o.min, Number(input.value)));
    const safe = Number.isFinite(v) ? v : o.min;
    input.value = String(safe);
    o.onChange(safe);
  });
  const wrap = h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    input,
  ) as unknown as HTMLElement & {
    input: HTMLInputElement;
  };
  wrap.input = input;
  return wrap;
}

export function textField(
  label: string,
  value: string,
  o: { maxLength: number; multiline?: boolean; placeholder?: string },
): HTMLElement & { input: HTMLInputElement | HTMLTextAreaElement } {
  const id = nextId('txt');
  const input = o.multiline
    ? h('textarea', { id, class: 'input', maxLength: o.maxLength, rows: 3, placeholder: o.placeholder })
    : h('input', { id, type: 'text', class: 'input', maxLength: o.maxLength, placeholder: o.placeholder });
  input.value = value;
  const wrap = h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    input,
  ) as unknown as HTMLElement & {
    input: HTMLInputElement | HTMLTextAreaElement;
  };
  wrap.input = input;
  return wrap;
}
