export default function Placeholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-1">
        {hint ?? 'Pantalla pendiente en próximo hito.'}
      </p>
    </div>
  );
}
