/** PWA: service-worker registration (production) and the install prompt. */
interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BeforeInstallPromptEvent | null = null;

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; });
  window.addEventListener('appinstalled', () => { deferred = null; });
}
export function canInstall(): boolean { return deferred !== null; }
export async function promptInstall(): Promise<boolean> {
  const d = deferred;
  if (!d) return false;
  deferred = null;
  await d.prompt();
  return (await d.userChoice).outcome === 'accepted';
}

/** Build id (commit + time) injected at build time; 'dev' in the dev server. */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

type ApplyUpdate = () => Promise<void>;
let updateHandler: ((apply: ApplyUpdate) => void) | null = null;
let pendingApply: ApplyUpdate | null = null;
let registration: ServiceWorkerRegistration | null = null;
const UPDATE_CHECK_MS = 15 * 60 * 1000;

/**
 * Register the game's handler for "a new version is installed and waiting". The handler receives
 * `apply`, which activates the new service worker and reloads the page; the game calls it when
 * it is safe (between waves, after a save). A version that arrived before the handler is delivered
 * immediately.
 */
export function onUpdateReady(handler: (apply: ApplyUpdate) => void): void {
  updateHandler = handler;
  if (pendingApply) handler(pendingApply);
}

/** Ask the browser to look for a newer service worker now (Help → About). */
export async function checkForUpdate(): Promise<'waiting' | 'checking' | 'none' | 'unavailable'> {
  if (!registration) return 'unavailable';
  try { await registration.update(); } catch { return 'unavailable'; }
  if (registration.waiting) return 'waiting';
  if (registration.installing) return 'checking';
  return 'none';
}

export async function registerPwa(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        pendingApply = () => updateSW(true);
        updateHandler?.(pendingApply);
      },
      onRegisteredSW(_url, reg) {
        registration = reg ?? null;
        if (!reg) return;
        // A home-screen app that is only backgrounded never navigates, so the browser never checks
        // for a new worker on its own: check whenever the app comes back and every 15 minutes.
        const check = (): void => { if (!document.hidden) reg.update().catch(() => { /* offline */ }); };
        document.addEventListener('visibilitychange', check);
        window.setInterval(check, UPDATE_CHECK_MS);
      },
    });
  } catch (err) {
    console.warn('[pwa] service worker registration skipped:', err);
  }
}
