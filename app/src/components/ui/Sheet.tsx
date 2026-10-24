import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/scrollLock';

// Fondo de hojas y diálogos. Va en un portal a <body> para quedar sobre la
// barra inferior (si se queda dentro del encabezado o del main, la barra lo
// tapa) y congela la página de atrás mientras está abierto.
export function Backdrop({ onClose, children, label }: { onClose?: () => void; children: React.ReactNode; label?: string }) {
  useScrollLock(true);
  return createPortal(
    <div className="fixed inset-0 z-40 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4 overscroll-contain" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

// Panel estándar: hoja desde abajo en el teléfono (con el borde seguro del
// iPhone), tarjeta centrada en pantallas grandes.
export const SHEET_PANEL = 'w-full bg-cream-50 rounded-t-2xl sm:rounded-xl shadow-lift p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 max-h-[90dvh] overflow-y-auto overscroll-contain';

// Barra de acciones fija al pie de un panel con scroll.
export const SHEET_ACTIONS = 'sticky -bottom-[calc(1.25rem+env(safe-area-inset-bottom))] sm:-bottom-5 -mx-5 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 mt-5 bg-cream-50 border-t border-charcoal-100 flex gap-2';
