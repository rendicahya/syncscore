/** UI services: toasts, confirmation dialogs and theme. No student data is logged. */

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Optional extra lines shown as a list. */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Extra choice (e.g. "Lewati konflik"). Resolves to 'alt'. */
  altLabel?: string;
}

export type ConfirmAnswer = 'confirm' | 'alt' | 'cancel';

interface PendingConfirm extends ConfirmRequest {
  resolve: (answer: ConfirmAnswer) => void;
}

export interface PromptRequest {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
}

interface PendingPrompt extends PromptRequest {
  resolve: (value: string | null) => void;
}

class UiState {
  toasts = $state<Toast[]>([]);
  confirm = $state<PendingConfirm | null>(null);
  prompt = $state<PendingPrompt | null>(null);

  /** Asks for a short text (e.g. a new name). Resolves to null when cancelled. */
  promptText(req: PromptRequest): Promise<string | null> {
    this.prompt?.resolve(null);
    return new Promise((resolve) => {
      this.prompt = { ...req, resolve };
    });
  }

  answerPrompt(value: string | null): void {
    const p = this.prompt;
    this.prompt = null;
    p?.resolve(value);
  }

  theme = $state<'light' | 'dark' | 'system'>('system');
  private nextId = 1;

  toast(kind: ToastKind, title: string, message?: string, timeout = kind === 'error' ? 8000 : 4500): void {
    const id = this.nextId++;
    this.toasts = [...this.toasts, { id, kind, title, message }];
    setTimeout(() => this.dismiss(id), timeout);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  ask(req: ConfirmRequest): Promise<ConfirmAnswer> {
    // Only one confirmation at a time; a new request cancels the previous one.
    this.confirm?.resolve('cancel');
    return new Promise((resolve) => {
      this.confirm = { ...req, resolve };
    });
  }

  async confirmAction(req: ConfirmRequest): Promise<boolean> {
    return (await this.ask(req)) === 'confirm';
  }

  answer(a: ConfirmAnswer): void {
    const c = this.confirm;
    this.confirm = null;
    c?.resolve(a);
  }

  initTheme(): void {
    try {
      const saved = localStorage.getItem('syncscore-theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') this.theme = saved;
    } catch {
      /* storage unavailable: keep default */
    }
    this.applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
  }

  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.theme = theme;
    try {
      localStorage.setItem('syncscore-theme', theme);
    } catch {
      /* ignore */
    }
    this.applyTheme();
  }

  get isDark(): boolean {
    return this.theme === 'dark' || (this.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  private applyTheme(): void {
    document.documentElement.classList.toggle('dark', this.isDark);
  }
}

export const ui = new UiState();
