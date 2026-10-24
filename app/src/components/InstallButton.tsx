import { useState } from 'react';
import Button from '@/components/ui/Button';
import { promptInstall, useInstallMode } from '@/lib/install';

// Botón fijo "Instalar app" (encabezado, barra lateral y login). En Android y
// computador abre la instalación del navegador; en iPhone/iPad explica los
// dos pasos de Safari. Desaparece cuando la app ya está instalada.
export default function InstallButton({ className = '' }: { className?: string }) {
  const mode = useInstallMode();
  const [help, setHelp] = useState(false);
  if (mode === 'hidden') return null;
  async function click() {
    if (mode === 'prompt') { await promptInstall(); return; }
    setHelp(true);
  }
  return (
    <>
      <button onClick={click} className={'inline-flex items-center gap-1.5 text-[11px] uppercase tracking-display rounded-md px-2.5 py-1.5 transition border border-brass-500/60 text-brass-300 hover:text-cream-50 hover:border-brass-300 ' + className} aria-label="Instalar Comandas como app">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></svg>
        Instalar app
      </button>
      {help && (
        <div className="fixed inset-0 z-[70] bg-charcoal-900/60 flex items-end sm:items-center justify-center p-4" onClick={() => setHelp(false)} role="dialog" aria-label="Instalar Comandas">
          <div className="w-full max-w-sm bg-cream-50 text-charcoal-800 rounded-xl shadow-lift p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Instalar Comandas</p>
            {mode === 'ios' ? (
              <ol className="space-y-2 text-sm list-decimal pl-5">
                <li>Abra esta página en <strong>Safari</strong> (en otros navegadores de iPhone no se puede).</li>
                <li>Toque <strong>Compartir</strong> <span aria-hidden>(el cuadrado con la flecha hacia arriba ⬆︎)</span>, abajo al centro.</li>
                <li>Elija <strong>«Agregar a inicio»</strong> y luego <strong>Agregar</strong>.</li>
              </ol>
            ) : (
              <ol className="space-y-2 text-sm list-decimal pl-5">
                <li>Abra el menú del navegador (<strong>⋮</strong> arriba a la derecha en Chrome).</li>
                <li>Elija <strong>«Instalar app»</strong> o <strong>«Agregar a la pantalla principal»</strong>.</li>
              </ol>
            )}
            <p className="text-xs text-charcoal-500">Queda como un ícono más en el teléfono y abre a pantalla completa. La primera vez dentro de la app instalada hay que ingresar de nuevo.</p>
            <Button className="w-full" onClick={() => setHelp(false)}>Entendido</Button>
          </div>
        </div>
      )}
    </>
  );
}
