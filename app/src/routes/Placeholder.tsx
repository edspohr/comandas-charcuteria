export default function Placeholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <p className="eyebrow">Sección</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">{title}</h1>
      </header>
      <div className="card p-8 text-center">
        <p className="eyebrow mb-2">Próximamente</p>
        <p className="text-sm text-charcoal-500">{hint ?? 'Pantalla pendiente en próximo hito.'}</p>
      </div>
    </div>
  );
}
