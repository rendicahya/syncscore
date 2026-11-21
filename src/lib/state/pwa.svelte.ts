/**
 * Progressive Web App state: service worker registration, update prompt,
 * offline readiness, install prompt and connectivity.
 * The service worker only caches the static application files; student data stays in IndexedDB.
 */
import { registerSW } from 'virtual:pwa-register';
import { app } from './app.svelte';
import { ui } from './ui.svelte';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

class PwaState {
  /** A newer version has been downloaded and waits for the user's consent. */
  needRefresh = $state(false);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  canInstall = $state(false);
  installed = $state(false);

  private updateSW: ((reload?: boolean) => Promise<void>) | null = null;
  private installEvent: BeforeInstallPromptEvent | null = null;
  private started = false;

  init(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    this.installed = window.matchMedia('(display-mode: standalone)').matches;
    window.addEventListener('online', () => (this.online = true));
    window.addEventListener('offline', () => (this.online = false));
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e as BeforeInstallPromptEvent;
      this.canInstall = true;
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = null;
      this.canInstall = false;
      this.installed = true;
      ui.toast('success', 'SyncScore terpasang', 'Aplikasi dapat dibuka dari menu aplikasi atau desktop, juga tanpa internet.');
    });

    if (!('serviceWorker' in navigator)) return;
    this.updateSW = registerSW({
      onNeedRefresh: () => {
        this.needRefresh = true;
      },
      onOfflineReady: () => {
        ui.toast('success', 'Siap dipakai offline', 'SyncScore kini dapat dibuka tanpa koneksi internet di browser ini.');
      },
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        setInterval(() => {
          if (navigator.onLine) void registration.update().catch(() => undefined);
        }, UPDATE_CHECK_MS);
      },
      onRegisterError: () => {
        // Offline support is optional; the app keeps working online. Nothing is logged.
      },
    });
  }

  /** Saves pending project changes, then activates the new version and reloads. */
  async applyUpdate(): Promise<void> {
    try {
      await app.flushSave();
    } catch {
      ui.toast('error', 'Pembaruan ditunda', 'Perubahan terakhir belum tersimpan. Coba lagi sebentar.');
      return;
    }
    this.needRefresh = false;
    await this.updateSW?.(true);
  }

  dismissUpdate(): void {
    this.needRefresh = false;
  }

  async install(): Promise<void> {
    const e = this.installEvent;
    if (!e) return;
    await e.prompt();
    const choice = await e.userChoice;
    if (choice.outcome === 'accepted') this.canInstall = false;
    this.installEvent = null;
  }
}

export const pwa = new PwaState();
