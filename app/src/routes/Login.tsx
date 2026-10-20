import { useState, type ReactNode } from 'react';
import { DEMO_PASSWORD, demoUsers, type DemoUser } from '@/data/demo-users';
import { authErrorMessage, requestPasswordReset, signInWithGoogle, signInWithPassword, useCurrentUser } from '@/data/auth';
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/permissions';
import Logo, { LogoLockup } from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import type { Role } from '@/domain/types';

// Login como landing: quien entra todos los días tiene el acceso arriba (en
// móvil va justo después del titular), y quien la ve por primera vez —dueños,
// equipo nuevo— entiende qué hace la app y cómo viaja un pedido.
// Tarjetas por persona solo en desarrollo (emuladores con la seed).
const DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN === 'true';

export default function Login() {
  return (
    <main className="min-h-screen bg-cream-50 text-charcoal-700">
      <TopBar />
      <Hero />
      <Flow />
      <Features />
      <BsaleSection />
      <Profiles />
      <Footer />
    </main>
  );
}

function TopBar() {
  return (
    <div className="bg-charcoal-900 text-cream-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Solo la palabra: la marca completa va en el hero, dos logos competían. */}
        <span className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.32em] text-brass-300">
          <span aria-hidden className="h-4 w-[3px] rounded-full bg-brass-500" />
          Comandas
        </span>
        <a href="#ingresar" className="lg:hidden text-[11px] uppercase tracking-display border border-cream-100/30 rounded-md px-3 py-1.5 hover:border-cream-100/60">Ingresar</a>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="bg-charcoal-900 text-cream-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-14 lg:pt-14 lg:pb-20 grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
        <div>
          <div className="mb-6 text-[15px] sm:text-lg"><LogoLockup size={52} /></div>
          <p className="text-[11px] uppercase tracking-display text-brass-300 font-semibold">Comandas · Barrio Franklin</p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight tracking-[0.01em]">
            Del pedido a la entrega,<br className="hidden sm:block" /> sin perder nada en el camino.
          </h1>
          <p className="mt-4 text-sm sm:text-lg text-cream-100/80 max-w-xl">
            Comandas reemplaza el grupo de WhatsApp y trabaja junto a Bsale: cada pedido con su formato y el stock real
            a la vista, un responsable en cada etapa, la factura emitida desde la misma app y las cifras del negocio para los dueños.
          </p>
          <Stats className="hidden lg:grid" />
        </div>
        {/* En móvil el acceso va antes de las cifras: el equipo entra sin scroll. */}
        <div id="ingresar" className="scroll-mt-4">
          <LoginCard />
          {DEMO_LOGIN && <DemoTiles />}
        </div>
        <Stats className="grid lg:hidden -mt-2" />
      </div>
    </section>
  );
}

function Stats({ className }: { className: string }) {
  return (
    <ul className={`mt-8 grid-cols-2 gap-3 max-w-xl ${className}`}>
      <Stat value="4 pasos" label="para tomar un pedido desde el teléfono" />
      <Stat value="Sin retipeo" label="factura, producción y traslados se escriben en Bsale" />
      <Stat value="2 años" label="de ventas de Bsale en el panel de gestión" />
      <Stat value="8 perfiles" label="cada persona ve solo lo suyo" />
    </ul>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <li className="rounded-lg border border-cream-100/15 bg-cream-50/[0.04] px-4 py-3">
      <p className="text-xl font-semibold text-brass-300">{value}</p>
      <p className="text-xs text-cream-100/70 mt-0.5">{label}</p>
    </li>
  );
}

type Mode = 'login' | 'reset';

function LoginCard() {
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
    <div className="card p-5 sm:p-6 text-charcoal-700 shadow-lift">
      <p className="eyebrow">Acceso del equipo</p>
      <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-1 mb-4">Ingresar</h2>
      <div className="space-y-4">
        <Button className="w-full" variant="secondary" onClick={() => run('google', signInWithGoogle)} disabled={pending !== null}>
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
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" />
          </label>
          {mode === 'login' && (
            <label className="block">
              <span className="text-xs text-charcoal-500">Contraseña</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1" />
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

        <p className="text-[11px] text-charcoal-300 text-center">El acceso es por invitación. Si no puede entrar, pídale a administración que lo agregue con su correo.</p>
      </div>
    </div>
  );
}

// ---------- Cómo viaja un pedido ----------

const STEPS: Array<{ who: string; title: string; text: string }> = [
  { who: 'Vendedor', title: 'Toma el pedido', text: 'Elige cliente, productos y fecha viendo el stock disponible. Si falta, la app separa lo que hay y avisa a producción.' },
  { who: 'Producción', title: 'Ve lo que falta', text: 'La demanda pendiente por producto y fecha. Registra lo producido y entra al stock de Bsale sin volver a digitarlo.' },
  { who: 'Despacho', title: 'Arma con peso real', text: 'Toma el pedido, registra lo que realmente se empacó y lo deja listo para facturar.' },
  { who: 'Administración', title: 'Factura desde Comandas', text: 'Revisa la vista previa y emite la factura o boleta en Bsale con los pesos empacados. La reserva se libera sola.' },
  { who: 'Reparto', title: 'Entrega', text: 'Marca la salida y la entrega con una nota. El vendedor ve el estado sin preguntar.' },
];

function Flow() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
      <SectionTitle eyebrow="Cómo viaja un pedido" title="Un responsable en cada etapa" />
      <ol className="mt-8 grid gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.who} className="card p-4 relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-charcoal-900 text-cream-50 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
              <span className="text-[10px] uppercase tracking-display font-semibold text-brass-600">{s.who}</span>
            </div>
            <p className="font-semibold text-charcoal-900 text-sm">{s.title}</p>
            <p className="text-xs text-charcoal-500 mt-1 leading-relaxed">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- Funcionalidades ----------

const FEATURES: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <IconPhone />, title: 'Pedido en 4 pasos', text: 'Cliente, productos, entrega y confirmar. Con una mano, desde el teléfono, "Repetir último pedido" para los habituales y muestras sin cargo en el mismo pedido.' },
  { icon: <IconSpark />, title: 'Pedido IA', text: 'Pegue el mensaje de WhatsApp del cliente y la app lo convierte en un pedido con productos, cantidades, muestras ("incluir muestra de…") y datos del cliente.' },
  { icon: <IconBox />, title: 'Stock real de Bsale', text: 'Semáforo por producto con lo que reporta Bsale menos lo ya reservado. Nadie vende lo que no hay.' },
  { icon: <IconBoard />, title: 'Tablero con visión y detalle', text: 'Resumen por etapa con montos y kilos, vista en tarjetas, compacta o lista, y el detalle del pedido a un clic. Rojo si se atrasa.' },
  { icon: <IconScale />, title: 'Facturar sin retipeo', text: 'La factura o boleta sale de Comandas a Bsale con el peso real empacado y el precio de la lista. Todo queda en la bitácora.' },
  { icon: <IconStore />, title: 'Reposición de tienda', text: 'La tienda pide por el mismo canal, el panel sugiere qué llevar según lo que vende y el traslado se registra en Bsale.' },
  { icon: <IconUsers />, title: 'Clientes y cartera', text: 'Ritmo de compra de cada cliente, quién está en riesgo y quién se perdió, y el seguimiento de cada muestra a los 7 días.' },
  { icon: <IconChart />, title: 'Panel de gestión', text: 'Dos años de ventas de Bsale: margen, productos ABC, clientes, vendedores, estacionalidad, stock, muestras que terminan en venta y un explorador con exportación a Excel.' },
];

function Features() {
  return (
    <section className="bg-cream-100/60 border-y border-charcoal-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <SectionTitle eyebrow="Funcionalidades" title="Hecho para cómo trabaja la fábrica" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.title} className="card p-5">
              <div className="w-10 h-10 rounded-md bg-charcoal-900 text-brass-300 flex items-center justify-center mb-3">{f.icon}</div>
              <h3 className="font-semibold text-charcoal-900 text-sm">{f.title}</h3>
              <p className="text-xs text-charcoal-500 mt-1.5 leading-relaxed">{f.text}</p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-xs text-charcoal-500 text-center">Se instala en el teléfono como una app y guarda el borrador del pedido aunque se corte la señal.</p>
      </div>
    </section>
  );
}

// ---------- Comandas + Bsale ----------

const OWNERSHIP: Array<[string, string[]]> = [
  ['Bsale es la fuente de', ['Catálogo, precios y costos', 'Clientes y sus datos tributarios', 'Stock de fábrica y tienda', 'Facturas, boletas y notas de crédito']],
  ['Comandas es la fuente de', ['Pedidos, estados y responsables', 'Reservas de stock y pesos empacados', 'Cartera de cada vendedor', 'Demanda pendiente para producción']],
];

function BsaleSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
      <SectionTitle eyebrow="Integración con Bsale" title="Una sola verdad, sin digitar dos veces" />
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        {OWNERSHIP.map(([title, items]) => (
          <div key={title} className="card p-5">
            <p className="text-[10px] uppercase tracking-display font-semibold text-brass-600">{title}</p>
            <ul className="mt-2 space-y-1.5 text-sm text-charcoal-700">
              {items.map((i) => <li key={i} className="flex gap-2"><span className="text-brass-500">—</span>{i}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-charcoal-500 text-center max-w-2xl mx-auto">
        Se sincroniza cada 10 minutos y con avisos de Bsale. Comandas solo escribe en Bsale lo que nace en la operación (facturas, producción, traslados, muestras y clientes nuevos), primero en simulacro y siempre con registro.
      </p>
    </section>
  );
}

function Profiles() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
      <SectionTitle eyebrow="Perfiles" title="Cada persona ve lo que necesita" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-charcoal-100 bg-white p-4">
            <p className="text-[10px] uppercase tracking-display font-semibold text-brass-600">{ROLE_LABEL[r]}</p>
            <p className="text-xs text-charcoal-500 mt-1 leading-relaxed">{ROLE_DESCRIPTION[r]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-charcoal-900 text-cream-100/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] uppercase tracking-display">
        <span className="flex items-center gap-2"><Logo size={22} /> La Charcutería Artesanal · Franklin 741, Santiago</span>
        <a href="#ingresar" className="hover:text-cream-50">Ingresar ↑</a>
      </div>
    </footer>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <p className="eyebrow text-brass-600">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold text-charcoal-900 tracking-display uppercase">{title}</h2>
    </div>
  );
}

// ---------- Desarrollo ----------

function DemoTiles() {
  const [pending, setPending] = useState<string | null>(null);
  async function loginAs(u: DemoUser) {
    setPending(u.uid);
    try { await signInWithPassword(u.email, DEMO_PASSWORD); } catch { setPending(null); }
  }
  return (
    <div className="mt-4 card p-4">
      <p className="eyebrow mb-2">Usuarios de desarrollo · {DEMO_PASSWORD}</p>
      <div className="space-y-2">
        {ROLES.map((role: Role) => {
          const users = demoUsers.filter((u) => u.role === role);
          if (users.length === 0) return null;
          return (
            <div key={role} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-display text-charcoal-300 w-24">{ROLE_LABEL[role]}</span>
              {users.map((u) => (
                <button key={u.uid} type="button" onClick={() => loginAs(u)} disabled={pending !== null} className="rounded border border-charcoal-200 px-2 py-1 text-xs text-charcoal-700 hover:border-brass-500 disabled:opacity-50">
                  {pending === u.uid ? '…' : u.displayName}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Iconos (trazo simple, heredan color) ----------

function Svg({ children }: { children: ReactNode }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
}
function IconPhone() { return <Svg><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></Svg>; }
function IconSpark() { return <Svg><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></Svg>; }
function IconBox() { return <Svg><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></Svg>; }
function IconBoard() { return <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></Svg>; }
function IconScale() { return <Svg><path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z" /></Svg>; }
function IconStore() { return <Svg><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16M10 20v-5h4v5" /></Svg>; }
function IconUsers() { return <Svg><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.8a3.2 3.2 0 0 1 0 6.4M18 14.8c1.8.6 3 2.4 3 5.2" /></Svg>; }
function IconChart() { return <Svg><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>; }

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden className="inline-block -mt-0.5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
