import type { IconNode } from 'lucide';
import { h, icon, setText } from '../dom';

/** Card/panel with a header (title, optional icon and actions) and body. */
export function panel(
  title: string,
  o: { icon?: IconNode; actions?: Node[]; class?: string; subtitle?: string; testId?: string } = {},
  ...body: (Node | null)[]
): HTMLElement & { body: HTMLElement } {
  const content = h('div', { class: 'panel-body' }, ...body);
  const el = h(
    'section',
    { class: `panel ${o.class ?? ''}`, 'data-testid': o.testId },
    h(
      'header',
      { class: 'panel-head' },
      h(
        'div',
        { class: 'panel-title' },
        o.icon ? icon(o.icon, 16) : null,
        h('h2', null, title),
        o.subtitle ? h('span', { class: 'panel-sub' }, o.subtitle) : null,
      ),
      o.actions ? h('div', { class: 'panel-actions' }, ...o.actions) : null,
    ),
    content,
  ) as HTMLElement & { body: HTMLElement };
  el.body = content;
  return el;
}

export interface StatTile extends HTMLElement {
  set(value: string, sub?: string): void;
}

/** Compact metric tile. Values are set via `set` which only touches the DOM on change. */
export function stat(label: string, value = '—', testId?: string): StatTile {
  const v = h('div', { class: 'stat-value', 'data-testid': testId }, value);
  const sub = h('div', { class: 'stat-sub' });
  const el = h(
    'div',
    { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    v,
    sub,
  ) as unknown as StatTile;
  el.set = (value, s) => {
    setText(v, value);
    setText(sub, s ?? '');
  };
  return el;
}

export function emptyState(ico: IconNode, title: string, text: string, ...actions: Node[]): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(ico, 22)),
    h('h3', null, title),
    h('p', null, text),
    actions.length ? h('div', { class: 'empty-actions' }, ...actions) : null,
  );
}

export function pageHeader(title: string, subtitle: string, ...actions: (Node | null)[]): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    h('div', null, h('h1', null, title), h('p', { class: 'page-sub' }, subtitle)),
    h('div', { class: 'page-actions' }, ...actions),
  );
}

/** Simple data table. Cells are text (or nodes); nothing is parsed as HTML. */
export function table(headers: string[], rows: (string | Node)[][], testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table', 'data-testid': testId },
      h('thead', null, h('tr', null, ...headers.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c) => h('td', null, c))))),
    ),
  );
}
