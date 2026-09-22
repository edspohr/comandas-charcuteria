import { useState } from 'react';
import { DEMO_PASSWORD, demoUsers, type DemoUser } from '@/data/demo-users';
import { signInWithPassword } from '@/data/auth';
import { ROLE_LABEL } from '@/data/auth';
import type { Role } from '@/domain/types';

const ROLE_ORDER: Role[] = ['vendedor', 'armador', 'produccion', 'admin'];

export default function Login() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loginAs(user: DemoUser) {
    setPending(user.uid);
    setError(null);
    try {
      await signInWithPassword(user.email, DEMO_PASSWORD);
    } catch (e) {
      setError('No se pudo iniciar sesión. ¿Corrió el seed contra el emulador?');
      setPending(null);
    }
  }

  return (
    <main className="min-h-screen bg-brand-50 p-6 flex flex-col items-center">
      <div className="w-full max-w-lg">
        <header className="text-center mb-8 mt-4">
          <h1 className="text-3xl font-semibold text-brand-700">Comandas</h1>
          <p className="text-sm text-slate-600 mt-1">La Charcutería Artesanal</p>
        </header>

        <section className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-2 px-1">
              Ingrese como usuario de demo
            </p>
            <div className="space-y-4">
              {ROLE_ORDER.map((role) => (
                <RoleGroup
                  key={role}
                  role={role}
                  users={demoUsers.filter((u) => u.role === role)}
                  pending={pending}
                  onPick={loginAs}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm p-3">
              {error}
            </div>
          )}

          <p className="text-xs text-slate-500 text-center">
            Contraseña de todos los usuarios: <code className="font-mono">{DEMO_PASSWORD}</code>
          </p>
        </section>
      </div>
    </main>
  );
}

function RoleGroup({
  role, users, pending, onPick,
}: {
  role: Role;
  users: DemoUser[];
  pending: string | null;
  onPick: (u: DemoUser) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-700 mb-2 px-1">{ROLE_LABEL[role]}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {users.map((u) => {
          const isPending = pending === u.uid;
          return (
            <button
              key={u.uid}
              type="button"
              onClick={() => onPick(u)}
              disabled={pending !== null}
              className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-[0.98] transition disabled:opacity-50"
            >
              <div className="font-medium text-slate-900">{u.displayName}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {isPending ? 'Ingresando…' : ROLE_LABEL[u.role]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
