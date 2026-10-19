import { useState } from 'react';
import { DEMO_PASSWORD, demoUsers, type DemoUser } from '@/data/demo-users';
import { authErrorMessage, requestPasswordReset, signInWithGoogle, signInWithPassword, useCurrentUser } from '@/data/auth';
import { ROLES, ROLE_LABEL } from '@/domain/permissions';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import type { Role } from '@/domain/types';

// Tarjetas por persona solo en desarrollo (emuladores con la seed). En el
// proyecto real cada persona entra con su cuenta.
const DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN === 'true';

type Mode = 'login' | 'reset';

export default function Login() {
  const { denied } = useCurrentUser();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setPending(key); setError(null); setInfo(null);
    try { await fn(); } catch (e) { const m = authErrorMessage(e); if (m) setError(m); } finally { setPending(null); }
  }

  const google = () => run('google', signInWithGoogle);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'reset') {
      void run('reset', async () => {
        await requestPasswordReset(email);
        setInfo(`Si ${email.trim()} tiene acceso, le llegará un correo para crear una contraseña nueva.`);
        setMode('login');
      });
    } else {
      void run('password', () => signInWithPassword(email, password));
    }
  };

  const message = error ?? denied;

  return (
    <main className="min-h-screen bg-cream-50">
      <div className="mx-auto max-w-sm px-6 pt-12 pb-16">
        <header className="text-center mb-10">
          <div className="flex flex-col items-center gap-4">
            <Logo size={68} />
            <div>
              <p className="eyebrow">La Charcutería Artesanal</p>
              <h1 className="mt-1 text-3xl font-semibold text-charcoal-900 tracking-display uppercase">Comandas</h1>
              <p className="mt-2 text-xs text-charcoal-300 tracking-display uppercase">Barrio Franklin · Santiago</p>
            </div>
          </div>
        </header>

        <section className="card p-5 space-y-4">
          <Button className="w-full" variant="secondary" onClick={google} disabled={pending !== null}>
            <GoogleMark /> {pending === 'google' ? 'Ingresando…' : 'Continuar con Google'}
          </Button>

          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-charcoal-100" />
            <span className="eyebrow">o con su correo</span>
            <span className="h-px flex-1 bg-charcoal-100" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-charcoal-500">Correo</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1 w-full" />
            </label>
            {mode === 'login' && (
              <label className="block">
                <span className="text-xs text-charcoal-500">Contraseña</span>
                <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1 w-full" />
              </label>
            )}
            <Button type="submit" className="w-full" disabled={pending !== null}>
              {mode === 'reset'
                ? (pending === 'reset' ? 'Enviando…' : 'Enviar correo para crear contraseña')
                : (pending === 'password' ? 'Ingresando…' : 'Ingresar')}
            </Button>
          </form>

          <div className="text-center">
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setError(null); }} className="text-xs text-charcoal-500 underline hover:text-charcoal-900">
              {mode === 'login' ? '¿Olvidó su contraseña o es su primera vez?' : 'Volver a ingresar'}
            </button>
          </div>

          {message && <div role="alert" className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2">{message}</div>}
          {info && <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2">{info}</div>}
        </section>

        <p className="mt-6 text-[11px] text-charcoal-300 text-center">
          El acceso es por invitación. Si no puede entrar, pídale a administración que lo agregue con su correo.
        </p>

        {DEMO_LOGIN && <DemoTiles />}
      </div>
    </main>
  );
}

function DemoTiles() {
  const [pending, setPending] = useState<string | null>(null);
  async function loginAs(u: DemoUser) {
    setPending(u.uid);
    try { await signInWithPassword(u.email, DEMO_PASSWORD); } catch { setPending(null); }
  }
  return (
    <section className="mt-10 space-y-4">
      <p className="eyebrow text-center">Usuarios de desarrollo · {DEMO_PASSWORD}</p>
      {ROLES.map((role: Role) => {
        const users = demoUsers.filter((u) => u.role === role);
        if (users.length === 0) return null;
        return (
          <div key={role}>
            <p className="text-[11px] text-charcoal-300 mb-1 px-1">{ROLE_LABEL[role]}</p>
            <div className="grid grid-cols-3 gap-2">
              {users.map((u) => (
                <button key={u.uid} type="button" onClick={() => loginAs(u)} disabled={pending !== null} className="card px-2 py-2 text-xs text-left hover:border-brass-500 disabled:opacity-50">
                  {pending === u.uid ? 'Ingresando…' : u.displayName}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden className="inline-block mr-1.5 -mt-0.5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
