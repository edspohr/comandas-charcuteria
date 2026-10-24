import { useSyncExternalStore } from 'react';

// "Instalar app": captures the browser's install prompt (Android / desktop
// Chrome and Edge) as soon as the page loads, so a fixed button can offer it
// at any time instead of a one-off popup. iOS Safari has no prompt: the
// button shows the two manual steps. Hidden when already installed.

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIOS = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export type InstallMode = 'hidden' | 'prompt' | 'ios' | 'manual';
let snapshot: InstallMode = 'hidden';
function mode(): InstallMode {
  const next: InstallMode = installed || isStandalone() ? 'hidden' : deferred ? 'prompt' : isIOS() ? 'ios' : 'manual';
  if (next !== snapshot) snapshot = next;
  return snapshot;
}
export function useInstallMode(): InstallMode {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, mode, () => 'hidden');
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; emit();
  return outcome === 'accepted';
}
