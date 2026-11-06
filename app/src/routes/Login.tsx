import InstallButton from '@/components/InstallButton';
import { useRef, useState, type ReactNode } from 'react';
import { DEMO_PASSWORD, demoUsers, type DemoUser } from '@/data/demo-users';
import { authErrorMessage, forgetRecentUser, recentUsers, requestPasswordReset, signInWithGoogle, signInWithPassword, signInWithPin, useCurrentUser, type RecentUser } from '@/data/auth';
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/permissions';
import Logo, { LogoLockup } from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import type { Role } from '@/domain/types';

// La landing es la página de ingreso: una sola página con el acceso arriba
// (en el teléfono, justo después del titular) y, más abajo, todo lo que hace
// Comandas para quien la ve por primera vez —dueños, equipo nuevo—.
// Mantenerla al día cada vez que sale una funcionalidad visible.
// Tarjetas por persona solo en desarrollo (emuladores con la seed).
const DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN === 'true';

const NAV: Array<[string, string]> = [
  ['#como-funciona', 'Cómo funciona'],
  ['#funcionalidades', 'Funcionalidades'],
  ['#bsale', 'Bsale'],
  ['#perfiles', 'Perfiles'],
  ['#primeros-pasos', 'Primeros pasos'],
];

export default function Login() {
  return (
    <main className="min-h-screen bg-cream-50 text-charcoal-700">
      <TopBar />
      <Hero />
      <Flow />
      <Features />
      <BsaleSection />
      <Profiles />
      <FirstSteps />
      <Footer />
    </main>
  );
}

function TopBar() {
  return (
    <div className="sticky top-0 z-30 bg-charcoal-900/95 backdrop-blur text-cream-50 border-b border-cream-100/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        {/* Solo la palabra: la marca completa va en el hero, dos logos competían. */}
        <a href="#top" className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.32em] text-brass-300">
          <span aria-hidden className="h-4 w-[3px] rounded-full bg-brass-500" />
          Comandas
        </a>
        <nav className="hidden md:flex items-center gap-5 text-[11px] uppercase tracking-display text-cream-100/70">
          {NAV.map(([href, label]) => <a key={href} href={href} className="hover:text-cream-50">{label}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <InstallButton />
          <a href="#ingresar" className="text-[11px] uppercase tracking-display bg-brass-500 text-charcoal-900 font-semibold rounded-md px-3 py-1.5 hover:bg-brass-300">Ingresar</a>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="bg-charcoal-900 text-cream-50 scroll-mt-14">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-14 lg:pt-14 lg:pb-20 grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
        <div>
          <div className="mb-6 text-[15px] sm:text-lg"><LogoLockup size={52} /></div>
          <p className="text-[11px] uppercase tracking-display text-brass-300 font-semibold">Comandas · Barrio Franklin</p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight tracking-[0.01em]">
            De la compra de la carne al pedido entregado.
          </h1>
          <p className="mt-4 text-sm sm:text-lg text-cream-100/80 max-w-xl">
            Comandas es la app de trabajo de La Charcutería Artesanal. Reemplaza el grupo de WhatsApp y trabaja junto a Bsale:
            pedidos con stock real, un responsable en cada etapa, la factura del POS ligada a cada pedido, la gestión comercial
            del equipo de ventas, las compras de insumos y las cifras del negocio para los dueños.
          </p>
          <Stats className="hidden lg:grid" />
        </div>
        {/* En móvil el acceso va antes de las cifras: el equipo entra sin scroll. */}
        <div id="ingresar" className="scroll-mt-20">
          <AccessCard />
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
      <Stat value="Sin retipeo" label="producción, traslados, muestras y clientes se escriben en Bsale" />
      <Stat value="2 años" label="de ventas de Bsale en el panel de gestión" />
      <Stat value="8 perfiles" label="cada persona ve solo lo suyo, con su PIN" />
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

// Ingreso diario con correo + PIN; la tarjeta de Google/contraseña queda para
// la primera vez (crear el PIN), si olvidó el PIN o si lo prefiere.
function AccessCard() {
  const [method, setMethod] = useState<'pin' | 'cuenta'>(() => (recentUsers().length ? 'pin' : 'cuenta'));
  return method === 'pin'
    ? <PinLoginCard onOtherMethod={() => setMethod('cuenta')} />
    : <LoginCard onPin={() => setMethod('pin')} />;
}

function PinLoginCard({ onOtherMethod }: { onOtherMethod: () => void }) {
  const { denied } = useCurrentUser();
  const [recent, setRecent] = useState<RecentUser[]>(() => recentUsers());
  const [email, setEmail] = useState(() => recentUsers()[0]?.email ?? '');
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && /^\d{4}$/.test(pin);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true); setError(null);
    try { await signInWithPin(email, pin); }
    catch (err) { setError(authErrorMessage(err) || 'No se pudo ingresar.'); setPin(''); pinRef.current?.focus(); }
    finally { setPending(false); }
  }

  const message = error ?? denied;
  return (
    <div className="card p-5 sm:p-6 text-charcoal-700 shadow-lift">
      <p className="eyebrow">Acceso del equipo</p>
      <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-1 mb-4">Ingresar con PIN</h2>
      {recent.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-charcoal-500 mb-1.5">En este dispositivo</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((u) => (
              <span key={u.email} className={'inline-flex items-center rounded-md border text-sm ' + (u.email === email ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-700')}>
                <button type="button" className="px-3 py-1.5" onClick={() => { setEmail(u.email); setPin(''); setError(null); setTimeout(() => pinRef.current?.focus(), 30); }}>{u.name}</button>
                <button type="button" aria-label={`Quitar a ${u.name} de este dispositivo`} className="pr-2 opacity-60 hover:opacity-100" onClick={() => { forgetRecentUser(u.email); setRecent(recentUsers()); if (email === u.email) setEmail(''); }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="text-xs text-charcoal-500">Correo</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-charcoal-500">PIN</span>
          <input ref={pinRef} type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="field mt-1 text-center text-2xl tracking-[0.6em] h-12" aria-label="PIN de 4 dígitos" />
        </label>
        <Button type="submit" className="w-full" disabled={!valid || pending}>{pending ? 'Ingresando…' : 'Ingresar'}</Button>
      </form>
      {message && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2">{message}</div>}
      <div className="text-center mt-4">
        <button type="button" onClick={onOtherMethod} className="text-xs text-charcoal-500 underline hover:text-charcoal-900">Primera vez, olvidó su PIN o prefiere Google / contraseña</button>
      </div>
    </div>
  );
}

function LoginCard({ onPin }: { onPin: () => void }) {
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

        <p className="text-[11px] text-charcoal-300 text-center">El acceso es por invitación. Si no puede entrar, pídale a administración que lo agregue con su correo. La primera vez la app le pide crear su PIN. Después encuentra la guía de su perfil en su nombre → «Guía de uso».</p>
        <div className="text-center">
          <button type="button" onClick={onPin} className="text-xs text-charcoal-500 underline hover:text-charcoal-900">Ya tengo PIN: entrar con correo y PIN</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Cómo viaja un pedido ----------

const STEPS: Array<{ who: string; title: string; text: string }> = [
  { who: 'Vendedor', title: 'Toma el pedido', text: 'Cliente, productos, fecha y horario en que el cliente recibe, viendo el stock disponible. Lo confirma con su PIN. Si falta producto, la app avisa a producción.' },
  { who: 'Producción', title: 'Produce lo que falta', text: 'Ve lo que esperan los pedidos de hoy y los próximos días. Carga lo producido con una foto de la planilla o a mano, y entra a Bsale como recepción.' },
  { who: 'Despacho', title: 'Arma con peso real', text: 'Toma los pedidos por hora de entrega, registra lo que realmente se empacó y rotula las muestras.' },
  { who: 'Administración', title: 'Factura en el POS', text: 'Emite en Bsale con los pesos del armado. Comandas sugiere el documento de cada pedido y la oficina lo confirma con su PIN.' },
  { who: 'Reparto', title: 'Entrega', text: 'Marca la salida y la entrega con quién recibió. El vendedor ve el estado sin preguntar.' },
];

function Flow() {
  return (
    <section id="como-funciona" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 scroll-mt-14">
      <SectionTitle eyebrow="Cómo funciona" title="Un responsable en cada etapa" />
      <p className="mt-3 text-sm text-charcoal-500 text-center max-w-2xl mx-auto">Así viaja un pedido. Cada paso queda a nombre de quien lo hizo y el tablero muestra en qué etapa está cada pedido, con montos, kilos y atrasos.</p>
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

// ---------- Funcionalidades, por área ----------

interface Feature { icon: ReactNode; title: string; text: string; tag?: string }
const AREAS: Array<{ title: string; intro: string; features: Feature[] }> = [
  {
    title: 'Ventas y clientes',
    intro: 'Para vendedores, la tienda y Ciro.',
    features: [
      { icon: <IconPhone />, title: 'Pedido en 4 pasos', text: 'Cliente, productos, entrega y confirmar, con una mano desde el teléfono. Se puede modificar hasta facturar y armado lo ve destacado en naranja. Horario de recepción obligatorio (una hora, un rango o una nota), «Repetir último pedido» para los habituales y condiciones especiales (precio, plazo, despacho) que Ciro aprueba antes de armar.' },
      { icon: <IconSpark />, title: 'Pedido IA', text: 'Pegue el mensaje de WhatsApp del cliente y la app lo convierte en pedido: productos, formatos, cantidades, muestras y datos del cliente. Usted revisa y confirma.' },
      { icon: <IconGift />, title: 'Muestras con seguimiento', text: 'Se agregan al pedido o salen solas, como consumo interno en Bsale. A los 7 días la app pide la opinión del cliente y mide cuántas terminan en venta a 60 días.' },
      { icon: <IconTarget />, title: 'Oportunidades', text: 'Ciro asigna visitas o las carga desde el informe de venta cruzada. Cada ejecutivo tiene su agenda del día: registra visitas, crea muestras y pedidos ligados, posterga con fecha o pierde con motivo. Un globo en el menú y un aviso al entrar le recuerdan lo nuevo, lo vencido y lo que vence hoy o mañana. Se gana sola cuando el pedido se factura.' },
      { icon: <IconUsers />, title: 'Clientes y cartera', text: 'Ficha con historial, ritmo de compra y salud del cliente (activo, en riesgo, perdido). Un cliente nuevo se crea desde el pedido y se registra en Bsale con sus datos tributarios.' },
    ],
  },
  {
    title: 'Operación en la fábrica',
    intro: 'Para producción, despacho, reparto y la tienda.',
    features: [
      { icon: <IconBoard />, title: 'Tablero de pedidos', text: 'Resumen por etapa con montos y kilos, vista en tarjetas, compacta o lista, filtros y el detalle a un toque. En rojo lo que se atrasa.' },
      { icon: <IconFactory />, title: 'Producción', text: 'Lo que falta producir según los pedidos, por día. La carga se hace con una foto de la planilla o a mano, entra a Bsale como recepción y reasigna el stock a los pedidos que esperaban.' },
      { icon: <IconScale />, title: 'Armado con peso real', text: 'Despacho y producción registran lo que realmente se empacó: el pedido se factura con esos pesos y la diferencia queda medida. «Total en armado» suma los productos de los pedidos tomados para ir a buscar todo de una vez, y cada pedido sale impreso en una comanda de 80 mm para pegar en el paquete.' },
      { icon: <IconStore />, title: 'Reposición de tienda', text: 'La tienda pide por el mismo canal, despacho registra el traslado en Bsale y la tienda confirma lo que llegó.' },
      { icon: <IconScan />, title: 'Compras e insumos', tag: 'Piloto', text: 'Al recibir una compra se escanean las etiquetas de cada caja: peso, lote y vencimiento. Con factura o guía, la foto o el PDF queda guardado, la app lee el timbre y las líneas y, si quiere, cuadra los kilos y el costo por kilo; también se puede registrar sin documento. Arma el stock de insumos por lote.' },
    ],
  },
  {
    title: 'Oficina y Bsale',
    intro: 'Para administración: lo que antes se digitaba dos veces.',
    features: [
      { icon: <IconSync />, title: 'Pendiente en Bsale', text: 'La lista de trabajo de la oficina: pedidos sin documento con el documento del POS sugerido, envíos a Bsale con error, producción y muestras por cargar y clientes por revisar. Se cierra el día en cero.' },
      { icon: <IconReceipt />, title: 'Factura ligada al pedido', text: 'Comandas encuentra el documento emitido en el POS (por referencia, RUT y total) y se confirma con el PIN. Antes de vincular, muestra cómo lo facturaría Comandas para comparar.' },
      { icon: <IconBox />, title: 'Stock y catálogo', text: 'Semáforo por producto con el stock de Bsale menos lo reservado, sincronizado cada 10 minutos. El cruce del catálogo con las variantes de Bsale se mantiene desde la app.' },
    ],
  },
  {
    title: 'Gestión y control',
    intro: 'Para los dueños y quien audita.',
    features: [
      { icon: <IconChart />, title: 'Panel de gestión', text: 'Dos años de ventas de Bsale: margen, productos ABC, clientes en riesgo, vendedores, estacionalidad, muestras que terminan en venta y un explorador con exportación a Excel.' },
      { icon: <IconWindow />, title: 'Ventana a Bsale', text: 'Documentos, stock, clientes y productos de Bsale en modo solo lectura, sin entrar a Bsale.' },
      { icon: <IconShield />, title: 'PIN y trazabilidad', text: 'Cada acción importante se confirma con el PIN personal y queda a nombre de quien la hizo. Cada escritura en Bsale queda en una bitácora. La app se bloquea tras 30 minutos sin uso.' },
      { icon: <IconKey />, title: 'Usuarios y perfiles', text: 'Super administración invita a cada persona con su perfil; quien vendía por WhatsApp entra con su historial y su cartera. El consultor ve todo sin poder modificar nada.' },
    ],
  },
];

function Features() {
  return (
    <section id="funcionalidades" className="bg-cream-100/60 border-y border-charcoal-100 scroll-mt-14">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <SectionTitle eyebrow="Funcionalidades" title="Hecho para cómo trabaja la fábrica" />
        <div className="mt-10 space-y-10">
          {AREAS.map((a) => (
            <div key={a.title}>
              <div className="flex items-baseline gap-3 flex-wrap mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-display text-charcoal-900">{a.title}</h3>
                <p className="text-xs text-charcoal-500">{a.intro}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {a.features.map((f) => (
                  <article key={f.title} className="card p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-md bg-charcoal-900 text-brass-300 flex items-center justify-center shrink-0">{f.icon}</div>
                      <h4 className="font-semibold text-charcoal-900 text-sm">{f.title}</h4>
                      {f.tag && <span className="ml-auto text-[10px] uppercase tracking-display rounded border border-brass-300 bg-brass-50 text-brass-700 px-1.5 py-0.5">{f.tag}</span>}
                    </div>
                    <p className="text-xs text-charcoal-500 leading-relaxed">{f.text}</p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-xs text-charcoal-500 text-center">Se instala en el teléfono como una app y guarda los borradores aunque se corte la señal.</p>
      </div>
    </section>
  );
}

// ---------- Comandas + Bsale ----------

const OWNERSHIP: Array<[string, string[]]> = [
  ['Bsale es la fuente de', ['Catálogo, precios y costos', 'Clientes y sus datos tributarios', 'Stock de venta en fábrica y tienda', 'Facturas, boletas y notas de crédito']],
  ['Comandas es la fuente de', ['Pedidos, estados, responsables y pesos empacados', 'Reservas de stock y demanda para producción', 'Oportunidades, muestras y cartera de cada vendedor', 'Compras de insumos, sus documentos y lotes']],
];

function BsaleSection() {
  return (
    <section id="bsale" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 scroll-mt-14">
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
        Se sincroniza cada 10 minutos y con avisos de Bsale. Comandas escribe en Bsale solo lo que nace en la operación: producción, traslados a la tienda, muestras y clientes nuevos. Cada escritura queda registrada y se confirma con el PIN de quien la hace. Las compras de insumos se quedan en Comandas: en Bsale vive solo el stock de venta.
      </p>
    </section>
  );
}

function Profiles() {
  return (
    <section id="perfiles" className="bg-cream-100/60 border-y border-charcoal-100 scroll-mt-14">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <SectionTitle eyebrow="Perfiles" title="Cada persona ve lo que necesita" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-charcoal-100 bg-white p-4">
              <p className="text-[10px] uppercase tracking-display font-semibold text-brass-600">{ROLE_LABEL[r]}</p>
              <p className="text-xs text-charcoal-500 mt-1 leading-relaxed">{ROLE_DESCRIPTION[r]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FIRST_STEPS: Array<[string, string]> = [
  ['Instale la app', 'Abra esta página en el teléfono y toque «Instalar app». En iPhone: Safari → Compartir → «Agregar a inicio».'],
  ['Entre por primera vez', 'Con «Continuar con Google» o con el correo para crear contraseña que le llegó. El acceso es por invitación: si no puede entrar, pídale a Ciro que lo agregue.'],
  ['Cree su PIN', 'Cuatro dígitos, personales. Desde ahí entra con correo y PIN, y lo usa para confirmar las acciones importantes.'],
  ['Siga la guía de su perfil', 'En su nombre → «Guía de uso» está lo que hace su perfil, paso a paso. Si olvida el PIN, Ciro lo borra y usted crea uno nuevo.'],
];

function FirstSteps() {
  return (
    <section id="primeros-pasos" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 scroll-mt-14">
      <SectionTitle eyebrow="Primeros pasos" title="Listo en cinco minutos" />
      <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIRST_STEPS.map(([title, text], i) => (
          <li key={title} className="card p-4">
            <span className="w-6 h-6 rounded-full bg-brass-500 text-charcoal-900 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
            <p className="font-semibold text-charcoal-900 text-sm mt-2">{title}</p>
            <p className="text-xs text-charcoal-500 mt-1 leading-relaxed">{text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 text-center">
        <a href="#ingresar" className="inline-flex items-center justify-center rounded-md bg-charcoal-700 text-cream-50 px-5 py-3 text-sm font-medium hover:bg-charcoal-900 shadow-soft">Ingresar a Comandas</a>
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
function IconGift() { return <Svg><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1zM12 7c1.5-3 5-3 5-1s-3 1-5 1z" /></Svg>; }
function IconTarget() { return <Svg><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" /></Svg>; }
function IconFactory() { return <Svg><path d="M3 21V10l6 4V10l6 4V6h6v15zM7 21v-3m5 3v-3m5 3v-3" /></Svg>; }
function IconScan() { return <Svg><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 8v8M10 8v8M13 8v8M17 8v8" /></Svg>; }
function IconSync() { return <Svg><path d="M20 11a8 8 0 0 0-14.6-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.4L20 16M20 20v-4h-4" /></Svg>; }
function IconReceipt() { return <Svg><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" /></Svg>; }
function IconWindow() { return <Svg><path d="M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01" /></Svg>; }
function IconShield() { return <Svg><path d="M12 3 4.5 6v6c0 4.4 3.2 7.9 7.5 9 4.3-1.1 7.5-4.6 7.5-9V6z" /><path d="m9 12 2 2 4-4" /></Svg>; }
function IconKey() { return <Svg><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></Svg>; }

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
