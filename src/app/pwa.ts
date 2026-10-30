import { toast } from '../ui/components/feedback';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const pwa = {
  installable: false,
  installed: matchMedia('(display-mode: standalone)').matches,
  serviceWorker: 'unsupported' as 'unsupported' | 'dev' | 'registering' | 'active' | 'update-ready' | 'error',
};

let deferred: BeforeInstallPromptEvent | null = null;
/** Set only when the user accepts an update; first-install `clients.claim()` must not reload the page. */
let updateAccepted = false;
let registration: ServiceWorkerRegistration | null = null;
const changed = () => window.dispatchEvent(new Event('pwachange'));

export async function installApp(): Promise<void> {
  if (!deferred) {
    toast(
      'Installation is not available here. In Safari use Share → Add to Home Screen; in other browsers use the address-bar install icon.',
      'info',
      undefined,
      8000,
    );
    return;
  }
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  pwa.installable = false;
  changed();
  if (outcome === 'accepted') toast('Autopilot Lab is being installed.', 'success');
}

export async function checkForUpdate(): Promise<void> {
  if (!registration) return toast('Offline support is not active in this build.', 'info');
  if (!navigator.onLine) return toast('You are offline — cannot check for updates.', 'warning');
  await registration.update().catch(() => toast('Update check failed.', 'error'));
  if (!registration.waiting) toast('You are running the latest version.', 'success');
}

function promptReload(worker: ServiceWorker): void {
  pwa.serviceWorker = 'update-ready';
  changed();
  toast(
    'A new version of Autopilot Lab is available.',
    'info',
    {
      label: 'Update now',
      run: () => {
        updateAccepted = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      },
    },
    0,
  );
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    pwa.installable = true;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    pwa.installed = true;
    pwa.installable = false;
    changed();
  });
  window.addEventListener('offline', () =>
    toast('You are offline. The simulator keeps working; your data stays on this device.', 'warning'),
  );
  window.addEventListener('online', () => toast('Back online.', 'success', undefined, 2500));

  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    pwa.serviceWorker = 'dev';
    return;
  }
  pwa.serviceWorker = 'registering';
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted) return;
    updateAccepted = false;
    location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      registration = reg;
      pwa.serviceWorker = 'active';
      changed();
      if (reg.waiting && navigator.serviceWorker.controller) promptReload(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          // Only an *update* when a previous worker already controls the page.
          if (w.state === 'installed' && navigator.serviceWorker.controller) promptReload(w);
        });
      });
      // Check for a new version hourly while the app stays open.
      setInterval(() => navigator.onLine && void reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch(() => {
      pwa.serviceWorker = 'error';
      changed();
    });
}
