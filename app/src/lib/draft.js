// localStorage-backed draft for the Nuevo pedido wizard.
// Persists per-vendedor so multiple users on the same browser don't collide.
const KEY = (uid) => `comandas.draft.${uid}`;
export function loadDraft(uid) {
    try {
        const raw = localStorage.getItem(KEY(uid));
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
export function saveDraft(uid, draft) {
    try {
        localStorage.setItem(KEY(uid), JSON.stringify(draft));
    }
    catch { /* quota */ }
}
export function clearDraft(uid) {
    try {
        localStorage.removeItem(KEY(uid));
    }
    catch { /* ignore */ }
}
