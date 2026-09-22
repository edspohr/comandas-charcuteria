import { useRegisterSW } from 'virtual:pwa-register/react';

// Renders a toast when the service worker has a new version ready. Manual
// registerType 'prompt' + explicit updateServiceWorker(true) means the
// page reloads only when the user asks for it — no silent stale bundles.
export default function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) { console.warn('[sw] register error', err); },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-40 card p-4 border-brass-500 bg-cream-50 shadow-lift">
      <p className="eyebrow">Actualización disponible</p>
      <p className="text-sm text-charcoal-700 mt-1 mb-3">
        Hay una versión nueva de Comandas. Recargue para verla.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setNeedRefresh(false)}
          className="flex-1 text-xs uppercase tracking-display text-charcoal-500 border border-charcoal-200 rounded-md py-2 hover:bg-cream-100"
        >
          Ahora no
        </button>
        <button
          onClick={() => updateServiceWorker(true)}
          className="flex-1 text-xs uppercase tracking-display bg-charcoal-900 text-cream-50 rounded-md py-2 hover:bg-charcoal-700"
        >
          Recargar
        </button>
      </div>
    </div>
  );
}
