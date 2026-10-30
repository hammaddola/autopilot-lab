import type { IconNode } from 'lucide';

/** A page mounts into `root` and returns its cleanup function. */
export type Page = (root: HTMLElement) => () => void;

export interface Route {
  path: string;
  label: string;
  icon: IconNode;
  load: () => Promise<{ default: Page }>;
}

/**
 * Hash-based router (works on static hosts such as GitHub Pages without rewrite rules).
 * Pages are lazy-loaded so the initial bundle stays small.
 */
export class Router {
  private cleanup: (() => void) | null = null;
  private seq = 0;

  constructor(
    private readonly routes: Route[],
    private readonly outlet: HTMLElement,
    private readonly onChange: (r: Route) => void,
  ) {
    window.addEventListener('hashchange', () => void this.render());
  }

  current(): Route {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0] || this.routes[0]!.path;
    return this.routes.find((r) => r.path === path) ?? this.routes[0]!;
  }

  go(path: string): void {
    if (location.hash === `#/${path}`) void this.render();
    else location.hash = `#/${path}`;
  }

  async render(): Promise<void> {
    const route = this.current();
    const seq = ++this.seq;
    this.onChange(route);
    const mod = await route.load();
    if (seq !== this.seq) return; // a newer navigation won
    this.cleanup?.();
    this.outlet.replaceChildren();
    this.outlet.scrollTop = 0;
    this.cleanup = mod.default(this.outlet);
    document.title = `${route.label} · Autopilot Lab`;
    this.outlet.focus({ preventScroll: true });
  }
}
