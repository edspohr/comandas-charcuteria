import Button from '@/components/ui/Button';
import { downloadCsv } from '@/lib/csv';

// Piezas visuales de los paneles (gestión y pedidos): métricas, tarjetas,
// tablas con exportación CSV.

export function Metric({ label, value, sub, delta, tone, deltaUnit = '%' }: { label: string; value: number | string; sub?: string; delta?: number | null; tone?: 'warn' | 'bad'; deltaUnit?: string }) {
  return (
    <div className={'card p-4 ' + (tone === 'warn' ? 'border-brass-300' : tone === 'bad' ? 'border-red-200' : '')}>
      <p className="eyebrow">{label}</p>
      <p className={'text-2xl font-semibold mt-1 tracking-display ' + (tone === 'warn' ? 'text-brass-700' : tone === 'bad' ? 'text-red-700' : 'text-charcoal-900')}>{value}</p>
      <p className="text-[11px] text-charcoal-300 mt-1 uppercase tracking-display flex items-center gap-2">
        {delta != null && <span className={delta >= 0 ? 'text-emerald-700' : 'text-red-700'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(deltaUnit === '%' ? 0 : 1)}{deltaUnit}</span>}
        {sub}
      </p>
    </div>
  );
}

export function Today({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={'rounded-md border px-3 py-2 flex items-baseline justify-between gap-2 ' + (tone === 'bad' ? 'bg-red-50 border-red-200' : tone === 'warn' ? 'bg-brass-50 border-brass-300' : 'bg-cream-100/60 border-charcoal-100')}>
      <span className="text-[10px] uppercase tracking-display text-charcoal-500">{label}</span>
      <span className={'text-lg font-semibold ' + (tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-brass-700' : 'text-charcoal-900')}>{value}</span>
    </div>
  );
}

export function Mini({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-md bg-cream-100/60 py-1.5">
      <p className={'text-base font-semibold ' + (tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-brass-700' : tone === 'bad' ? 'text-red-700' : 'text-charcoal-900')}>{value}</p>
      <p className="text-[9px] uppercase tracking-display text-charcoal-300">{label}</p>
    </div>
  );
}

export function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3"><p className="eyebrow">{title}</p>{action}</div>
      {children}
    </div>
  );
}

// The current period label is set by the panel on each render so every
// export carries it in the header without threading a prop through Table.
let currentPeriod = '';
export const setExportPeriod = (p: string) => { currentPeriod = p; };

export function Export({ name, rows, cols }: { name: string; rows: Array<object>; cols: Array<[string, string]> }) {
  return (
    <Button size="sm" variant="ghost" className="!py-1 !px-2 text-[11px]" onClick={() => downloadCsv(name, rows, cols.map(([key, label]) => ({ key, label })), currentPeriod)} disabled={rows.length === 0}>
      Exportar CSV
    </Button>
  );
}

export type Col = [string, string, ((v: unknown, row: Record<string, unknown>) => React.ReactNode)?];
const rec = (r: object) => r as Record<string, unknown>;

export function Table<T extends object>({ title, rows, cols, export: exp, rowTone, onRow, note, max }: { title: string; rows: T[]; cols: Col[]; export?: { name: string; rows: Array<object> }; rowTone?: (r: T) => 'warn' | 'bad' | undefined; onRow?: (r: T) => void; note?: React.ReactNode; max?: number }) {
  const shown = max ? rows.slice(0, max) : rows;
  return (
    <Card title={title} action={exp ? <Export name={exp.name} rows={exp.rows} cols={cols.map(([k, l]) => [k, l])} /> : undefined}>
      {note && <div className="text-xs text-charcoal-500 -mt-1 mb-2">{note}</div>}
      {rows.length === 0 ? <p className="text-xs text-charcoal-300">Sin datos en el período.</p> : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-display text-charcoal-300 border-b border-charcoal-100">
                {cols.map(([k, l], i) => <th key={k} className={'py-1.5 pr-3 font-semibold ' + (i > 0 ? 'text-right' : '')}>{l}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-100/70">
              {shown.map((r, ri) => {
                const tone = rowTone?.(r);
                return (
                  <tr key={ri} onClick={onRow ? () => onRow(r) : undefined} className={(tone === 'bad' ? 'bg-red-50/40' : tone === 'warn' ? 'bg-brass-50/40' : '') + (onRow ? ' cursor-pointer hover:bg-cream-100' : '')}>
                    {cols.map(([k, , fmt], i) => <td key={k} className={'py-1.5 pr-3 ' + (i > 0 ? 'text-right tabular-nums text-charcoal-700' : 'text-charcoal-900 font-medium')}>{fmt ? fmt(rec(r)[k], rec(r)) : String(rec(r)[k] ?? '')}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {max && rows.length > max && <p className="text-[11px] text-charcoal-300 mt-2">Mostrando {max} de {rows.length}. El CSV trae todas.</p>}
        </div>
      )}
    </Card>
  );
}
