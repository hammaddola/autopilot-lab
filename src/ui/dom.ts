import { createElement, type IconNode } from 'lucide';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/**
 * Tiny element factory. Text is always set via text nodes (never innerHTML), so user-supplied strings such
 * as driver names cannot inject markup. `on*` attributes become event listeners.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string')
        (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(node: IconNode, size = 16): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  return svg;
}

/** Sets text only when it changed (avoids needless DOM writes in live panels). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export const fmt = {
  int: (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '—'),
  num: (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—'),
  pct: (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'),
  /** Simulation units → metres (1 unit = 0.1 m). */
  dist: (units: number) =>
    units >= 10000 ? `${(units / 10000).toFixed(2)} km` : `${Math.round(units / 10)} m`,
  duration: (s: number) => {
    if (!Number.isFinite(s)) return '—';
    const m = Math.floor(s / 60),
      sec = Math.floor(s % 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(sec).padStart(2, '0')}`;
  },
  date: (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
};

export function download(filename: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with the chosen file's text (or null if cancelled). */
export function pickFile(accept: string, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > maxBytes)
        return reject(new Error(`File is too large (limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB).`));
      f.text().then(resolve, () => reject(new Error('Could not read the file.')));
    });
    input.click();
  });
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'export';
