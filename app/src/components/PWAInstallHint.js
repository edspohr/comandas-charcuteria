import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
const DISMISS_KEY = 'comandas.pwaHintDismissedAt';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000; // one week
export default function PWAInstallHint() {
    const [evt, setEvt] = useState(null);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        const raw = localStorage.getItem(DISMISS_KEY);
        if (raw && Date.now() - Number(raw) < DISMISS_MS)
            setDismissed(true);
    }, []);
    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            setEvt(e);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);
    if (dismissed || !evt)
        return null;
    return (_jsxs("div", { className: "fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-30 card p-4 border-brass-500 bg-cream-50", children: [_jsx("p", { className: "eyebrow", children: "Agregar a la pantalla de inicio" }), _jsx("p", { className: "text-sm text-charcoal-700 mt-1 mb-3", children: "Instale Comandas como app para tenerla siempre a mano." }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setDismissed(true); }, className: "flex-1 text-xs uppercase tracking-display text-charcoal-500 border border-charcoal-200 rounded-md py-2 hover:bg-cream-100", children: "Ahora no" }), _jsx("button", { onClick: async () => {
                            await evt.prompt();
                            const res = await evt.userChoice;
                            if (res.outcome === 'accepted')
                                setEvt(null);
                            else {
                                localStorage.setItem(DISMISS_KEY, String(Date.now()));
                                setDismissed(true);
                            }
                        }, className: "flex-1 text-xs uppercase tracking-display bg-charcoal-900 text-cream-50 rounded-md py-2 hover:bg-charcoal-700", children: "Instalar" })] })] }));
}
