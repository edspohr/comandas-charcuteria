// localStorage-backed draft for the Nuevo pedido wizard.
// Persists per-vendedor so multiple users on the same browser don't collide.

const KEY = (uid: string) => `comandas.draft.${uid}`;

export function loadDraft<T>(uid: string): T | null {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(uid: string, draft: T): void {
  try { localStorage.setItem(KEY(uid), JSON.stringify(draft)); } catch { /* quota */ }
}

export function clearDraft(uid: string): void {
  try { localStorage.removeItem(KEY(uid)); } catch { /* ignore */ }
}
