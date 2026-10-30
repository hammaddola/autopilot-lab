import '@fontsource-variable/inter';
import './ui/styles/main.css';
import {
  ChartLine,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  LibraryBig,
  Moon,
  Route as RouteIcon,
  Settings,
  Sun,
} from 'lucide';
import { controller } from './app/controller';
import { applyReducedMotion, applyTheme, prefs, updatePreferences } from './app/preferences';
import { initPwa } from './app/pwa';
import { initShortcuts, showShortcuts } from './app/shortcuts';
import { Router, type Route } from './app/router';
import { toast } from './ui/components/feedback';
import { h, icon } from './ui/dom';

const routes: Route[] = [
  {
    path: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    load: () => import('./ui/pages/dashboard'),
  },
  { path: 'studio', label: 'Simulation Studio', icon: RouteIcon, load: () => import('./ui/pages/studio') },
  {
    path: 'training',
    label: 'AI Training Lab',
    icon: FlaskConical,
    load: () => import('./ui/pages/training'),
  },
  { path: 'analytics', label: 'Analytics', icon: ChartLine, load: () => import('./ui/pages/analytics') },
  { path: 'library', label: 'Driver Library', icon: LibraryBig, load: () => import('./ui/pages/library') },
  { path: 'settings', label: 'Settings', icon: Settings, load: () => import('./ui/pages/settings') },
];

function checkSupport(): string[] {
  const missing: string[] = [];
  if (typeof Worker === 'undefined') missing.push('Web Workers');
  if (!document.createElement('canvas').getContext) missing.push('Canvas 2D');
  if (typeof indexedDB === 'undefined') missing.push('IndexedDB (saving will not work)');
  if (typeof structuredClone === 'undefined') missing.push('structuredClone');
  return missing;
}

function shell(): void {
  applyTheme(prefs.theme);
  applyReducedMotion(prefs.reducedMotion);
  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change',
    () => prefs.theme === 'system' && applyTheme('system'),
  );

  const links = routes.map((r) =>
    h(
      'a',
      { href: `#/${r.path}`, class: 'nav-link', 'data-path': r.path, 'data-testid': `nav-${r.path}` },
      icon(r.icon, 18),
      h('span', null, r.label),
    ),
  );
  const runDot = h('span', { class: 'run-dot', 'aria-hidden': 'true' });
  const runText = h('span', { class: 'small' }, 'Idle');
  const syncRun = () => {
    runDot.dataset.state = controller.status;
    runText.textContent = controller.hasSession
      ? `${{ train: 'Training', test: 'Testing', manual: 'Manual' }[controller.mode]} · ${controller.status}`
      : 'No simulation';
  };
  controller.on('status', syncRun);
  controller.on('session', syncRun);
  syncRun();

  const themeBtn = h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-icon',
    'aria-label': 'Toggle theme',
    title: 'Toggle theme',
    'data-testid': 'theme-toggle',
  });
  const syncThemeBtn = () =>
    themeBtn.replaceChildren(icon(document.documentElement.dataset.theme === 'dark' ? Sun : Moon, 18));
  themeBtn.addEventListener('click', () => {
    updatePreferences({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
  });
  window.addEventListener('themechange', syncThemeBtn);
  syncThemeBtn();

  const keysBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-ghost btn-icon',
      'aria-label': 'Keyboard shortcuts',
      title: 'Keyboard shortcuts (?)',
      onclick: () => void showShortcuts(),
    },
    icon(Keyboard, 18),
  );

  const brand = h(
    'a',
    { href: '#/dashboard', class: 'brand', 'aria-label': 'Autopilot Lab home' },
    h('img', { src: './icons/icon.svg', alt: '', width: 28, height: 28 }),
    h('span', { class: 'brand-text' }, 'AUTOPILOT', h('b', null, ' LAB')),
  );
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, ...links);
  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    brand,
    nav,
    h(
      'div',
      { class: 'sidebar-foot' },
      h('div', { class: 'run-state', 'data-testid': 'shell-run-state' }, runDot, runText),
      h('div', { class: 'sidebar-tools' }, keysBtn, themeBtn),
    ),
  );
  const outlet = h('main', { class: 'content', id: 'main', tabindex: -1 });
  const skip = h(
    'a',
    { href: '#main', class: 'skip-link', onclick: (e: Event) => (e.preventDefault(), outlet.focus()) },
    'Skip to content',
  );
  const app = document.getElementById('app')!;
  app.replaceChildren(skip, h('div', { class: 'layout' }, sidebar, outlet));

  const unsupported = checkSupport();
  if (unsupported.length)
    toast(`This browser lacks: ${unsupported.join(', ')}. Some features will not work.`, 'error');

  const router = new Router(routes, outlet, (r) => {
    for (const l of links) {
      const on = l.dataset.path === r.path;
      l.classList.toggle('active', on);
      if (on) l.setAttribute('aria-current', 'page');
      else l.removeAttribute('aria-current');
    }
  });
  void router.render().catch((err: Error) => toast(`Could not load page: ${err.message}`, 'error'));

  window.addEventListener('unhandledrejection', (e) => {
    toast(`Unexpected error: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`, 'error');
  });
  initShortcuts();
  initPwa();
}

shell();
