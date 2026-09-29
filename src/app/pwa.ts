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

export async function registerPwa(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch (err) {
    console.warn('[pwa] service worker registration skipped:', err);
  }
}
