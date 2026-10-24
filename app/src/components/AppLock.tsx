import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { isLocked, markUnlocked, signOut, touchActivity, useCurrentUser } from '@/data/auth';
import { RESPONSIBILITY_TEXT, setOwnPin, unlockWithPin } from '@/data/pin';

// Bloqueo con PIN personal. Sin PIN (primera vez o desactivado por intentos)
// la persona lo crea aceptando la declaración de responsabilidad; con PIN,
// la app se bloquea al abrirse y tras 30 minutos sin uso.
export default function AppLock() {
  const { current } = useCurrentUser();
  const [locked, setLocked] = useState(() => isLocked());
  const [provider, setProvider] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!current) return;
    current.fbUser.getIdTokenResult().then((t) => setProvider(t.signInProvider ?? null)).catch(() => setProvider(null));
  }, [current?.fbUser.uid]);

  useEffect(() => {
    const check = () => setLocked(isLocked());
    const activity = () => { const now = Date.now(); if (now - last.current > 15_000) { last.current = now; if (!isLocked()) touchActivity(); } };
    const id = window.setInterval(check, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', activity, { passive: true });
    window.addEventListener('keydown', activity);
    window.addEventListener('comandas:lock', check);
    return () => { window.removeEventListener('comandas:lock', check); window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); };
  }, []);

  if (!current) return null;
  const u = current.appUser;
  if (!u.hasPin || u.pinDisabled) {
    // A PIN session can't create a PIN (the server refuses): verify again.
    if (provider === 'custom') return <Overlay><NeedsReverify /></Overlay>;
    return <Overlay><CreatePin name={u.displayName} disabled={!!u.pinDisabled} onDone={() => { markUnlocked(); setLocked(false); }} /></Overlay>;
  }
  if (!locked) return null;
  return <Overlay><Unlock name={u.displayName} email={u.email} onDone={() => { markUnlocked(); setLocked(false); }} /></Overlay>;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[60] bg-charcoal-900/95 flex items-center justify-center p-4 overflow-y-auto">{children}</div>;
}

function PinInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-charcoal-500">{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus={autoFocus} value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} className="field mt-1 text-center text-2xl tracking-[0.6em] h-12" aria-label={label} />
    </label>
  );
}

function CreatePin({ name, disabled, onDone }: { name: string; disabled: boolean; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}$/.test(pin) && pin === again && accept;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    try { await setOwnPin(pin); onDone(); } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="w-full max-w-sm bg-cream-50 rounded-xl shadow-lift p-6 space-y-4">
      <div>
        <p className="eyebrow">{disabled ? 'PIN desactivado' : 'Primer ingreso'}</p>
        <h2 className="text-lg font-semibold text-charcoal-900 uppercase tracking-display mt-1">Cree su PIN, {name.split(' ')[0]}</h2>
        <p className="text-xs text-charcoal-500 mt-1">{disabled ? 'Su PIN anterior se desactivó por intentos fallidos. Cree uno nuevo.' : 'Con su correo y este PIN entra a Comandas, y lo usa para confirmar las acciones importantes.'} Son 4 dígitos que solo usted conoce: nadie de la empresa lo ve.</p>
      </div>
      <PinInput label="PIN (4 dígitos)" value={pin} onChange={setPin} autoFocus />
      <PinInput label="Repita el PIN" value={again} onChange={setAgain} />
      {again.length === 4 && pin !== again && <p className="text-xs text-red-700">Los PIN no coinciden.</p>}
      <label className="flex gap-2 items-start text-sm text-charcoal-800 rounded-md border border-charcoal-200 bg-white p-3">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 w-4 h-4" />
        <span>{RESPONSIBILITY_TEXT}</span>
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={!valid || busy}>{busy ? 'Guardando…' : 'Crear PIN y aceptar'}</Button>
      <button type="button" onClick={() => void signOut()} className="block mx-auto text-xs text-charcoal-500 underline">Cerrar sesión</button>
    </form>
  );
}

function Unlock({ name, email, onDone }: { name: string; email: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin) || busy) return;
    setBusy(true); setError(null);
    try { await unlockWithPin(pin); onDone(); } catch (err) { setError((err as Error).message); setPin(''); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="w-full max-w-xs bg-cream-50 rounded-xl shadow-lift p-6 space-y-4">
      <div className="text-center">
        <p className="eyebrow">Comandas bloqueado</p>
        <h2 className="text-lg font-semibold text-charcoal-900 mt-1">{name}</h2>
        <p className="text-xs text-charcoal-500">{email}</p>
      </div>
      <PinInput label="Ingrese su PIN" value={pin} onChange={setPin} autoFocus />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={!/^\d{4}$/.test(pin) || busy}>{busy ? 'Verificando…' : 'Desbloquear'}</Button>
      <button type="button" onClick={() => void signOut()} className="block mx-auto text-xs text-charcoal-500 underline">No soy {name.split(' ')[0]}: cambiar de usuario</button>
    </form>
  );
}

function NeedsReverify() {
  return (
    <div className="w-full max-w-sm bg-cream-50 rounded-xl shadow-lift p-6 space-y-3 text-center">
      <p className="eyebrow">PIN desactivado</p>
      <p className="text-sm text-charcoal-800">Para crear un PIN nuevo, cierre sesión y entre con Google o con su contraseña.</p>
      <Button className="w-full" onClick={() => void signOut()}>Cerrar sesión</Button>
    </div>
  );
}
