import { useState, type ReactNode } from 'react';

// Dense, scannable table used by Clientes / Catálogo / Usuarios / Producción.
// - Columns flagged `mobile` are the only ones shown under `md`; the rest
//   appear when the row is expanded, so a phone still gets the essentials.
// - Clicking a row toggles an inline detail panel (no modals).
export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  mobile?: boolean;          // keep visible on narrow screens
  align?: 'left' | 'right';
  width?: string;            // tailwind width class
  muted?: boolean;
}

export type RowTone = 'warn' | 'bad' | 'ok' | undefined;

export default function DataTable<T>({ rows, columns, rowKey, expand, rowTone, emptyText = 'Sin datos.', dense }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  expand?: (row: T) => ReactNode;
  rowTone?: (row: T) => RowTone;
  emptyText?: string;
  dense?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pad = dense ? 'py-1.5' : 'py-2.5';
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-display text-charcoal-300 border-b border-charcoal-100 bg-cream-100/40">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 ${pad} font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.mobile ? '' : 'hidden md:table-cell'} ${c.width ?? ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-100/70">
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-xs text-charcoal-300">{emptyText}</td></tr>
            )}
            {rows.map((r) => {
              const k = rowKey(r);
              const isOpen = open === k;
              const tone = rowTone?.(r);
              const toneCls = tone === 'bad' ? 'bg-red-50/40' : tone === 'warn' ? 'bg-brass-50/40' : tone === 'ok' ? 'bg-emerald-50/30' : '';
              return (
                <RowGroup key={k}>
                  <tr
                    onClick={expand ? () => setOpen(isOpen ? null : k) : undefined}
                    className={`${toneCls} ${expand ? 'cursor-pointer hover:bg-cream-100/50' : ''} ${isOpen ? 'bg-cream-100/60' : ''} transition`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 ${pad} align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.mobile ? '' : 'hidden md:table-cell'} ${c.muted ? 'text-charcoal-500' : 'text-charcoal-700'}`}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && expand && (
                    <tr className="bg-cream-100/40">
                      <td colSpan={columns.length} className="px-3 pb-3 pt-1">
                        {/* On mobile, surface the hidden columns first, then the detail. */}
                        <dl className="md:hidden grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
                          {columns.filter((c) => !c.mobile).map((c) => (
                            <div key={c.key} className="contents">
                              <dt className="eyebrow">{c.label}</dt>
                              <dd className="text-charcoal-700 text-right">{c.render(r)}</dd>
                            </div>
                          ))}
                        </dl>
                        {expand(r)}
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({ children }: { children: ReactNode }) { return <>{children}</>; }

// Small helpers shared by the table screens.
export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warn: 'bg-brass-50 text-brass-700 border-brass-300',
    bad: 'bg-red-50 text-red-700 border-red-200',
    muted: 'bg-charcoal-50 text-charcoal-500 border-charcoal-100',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
  }[tone];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-display whitespace-nowrap ${cls}`}>{children}</span>;
}
