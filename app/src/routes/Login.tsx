import { useState } from 'react';
import { DEMO_PASSWORD, demoUsers, type DemoUser } from '@/data/demo-users';
import { signInWithPassword, ROLE_LABEL } from '@/data/auth';
import Logo from '@/components/ui/Logo';
import type { Role } from '@/domain/types';

const ROLE_ORDER: Role[] = ['vendedor', 'despacho', 'produccion', 'admin', 'superAdmin'];

export default function Login() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loginAs(user: DemoUser) {
    setPending(user.uid);
    setError(null);
    try {
      await signInWithPassword(user.email, DEMO_PASSWORD);
    } catch {
      setError('No se pudo iniciar sesión. Verifique que los usuarios estén sembrados en el proyecto.');
      setPending(null);
    }
  }

  return (
    <main className="min-h-screen bg-cream-50">
      <div className="mx-auto max-w-lg px-6 pt-12 pb-16">
        <header className="text-center mb-10">
          <div className="flex flex-col items-center gap-4">
            <Logo size={68} />
            <div>
              <p className="eyebrow">La Charcutería Artesanal</p>
              <h1 className="mt-1 text-3xl font-semibold text-charcoal-900 tracking-display uppercase">Comandas</h1>
              <p className="mt-2 text-xs text-charcoal-300 tracking-display uppercase">
                Barrio Franklin · Santiago
              </p>
            </div>
          </div>
        </header>

        <section className="space-y-6">
          <div className="text-center">
            <p className="eyebrow">Elija su perfil</p>
          </div>

          <div className="space-y-5">
            {ROLE_ORDER.map((role) => {
              const users = demoUsers.filter((u) => u.role === role);
              if (users.length === 0) return null;
              return (
                <RoleGroup key={role} role={role} users={users} pending={pending} onPick={loginAs} />
              );
            })}
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2">
              {error}
            </div>
          )}

          <p className="text-[11px] text-charcoal-300 text-center tracking-[0.03em]">
            Contraseña demo: <code className="font-mono text-charcoal-500">{DEMO_PASSWORD}</code>
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
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="h-px flex-1 bg-charcoal-100" />
        <span className="eyebrow whitespace-nowrap">{ROLE_LABEL[role]}</span>
        <span className="h-px flex-1 bg-charcoal-100" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {users.map((u) => {
          const isPending = pending === u.uid;
          return (
            <button
              key={u.uid}
              type="button"
              onClick={() => onPick(u)}
              disabled={pending !== null}
              aria-label={`Ingresar como ${u.displayName}, ${ROLE_LABEL[u.role]}`}
              className="group card p-3 text-left transition hover:border-brass-500 hover:shadow-lift active:scale-[0.98] disabled:opacity-50"
            >
              <div className="font-semibold text-charcoal-700 text-sm">{u.displayName}</div>
              <div className="text-[11px] text-charcoal-300 mt-0.5 tracking-[0.02em]">
                {isPending ? 'Ingresando…' : ROLE_LABEL[u.role]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
