import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { usePinPrompt } from '@/data/pin';

// Diálogo global del PIN personal. Lo abre withPin() cuando el servidor lo pide.
export default function PinPrompt() {
  const p = usePinPrompt();
  const [pin, setPin] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (p.open) { setPin(''); setTimeout(() => input.current?.focus(), 50); } }, [p.open, p.error]);
  if (!p.open) return null;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (/^\d{4,6}$/.test(pin)) p.resolve?.(pin); };
  return (
    <div className="fixed inset-0 z-50 bg-charcoal-900/50 flex items-center justify-center p-4" role="dialog" aria-label="Ingrese su PIN">
      <form onSubmit={submit} className="w-full max-w-xs bg-cream-50 rounded-xl shadow-lift p-5 space-y-3">
        <div>
          <p className="eyebrow">Confirmar con su PIN</p>
          <p className="text-sm text-charcoal-900 font-semibold mt-1">{p.reason}</p>
          <p className="text-[11px] text-charcoal-500 mt-1">Queda registrado a su nombre. Usted responde por lo que se haga con su cuenta y su PIN.</p>
        </div>
        <input ref={input} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="field text-center text-2xl tracking-[0.5em] h-12" aria-label="PIN" />
        {p.error && <p className="text-xs text-red-700">{p.error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => p.resolve?.(null)}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={!/^\d{4,6}$/.test(pin)}>Confirmar</Button>
        </div>
      </form>
    </div>
  );
}
