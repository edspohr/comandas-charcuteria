import { useMemo, useState } from 'react';
import { Backdrop, SHEET_PANEL } from '@/components/ui/Sheet';
import Button from '@/components/ui/Button';
import { pickingTotals } from '@/domain/picking';
import type { Order } from '@/domain/types';
import { formatQty } from '@/lib/format';
import { PrinterSettingsDialog, usePrintOrders } from '@/components/orders/PrintTicket';

// Hoja «Total en armado»: lo que hay que ir a buscar para los pedidos tomados.
export default function PickingTotals({ orders, uid, onClose }: { orders: Order[]; uid: string; onClose: () => void }) {
  const inPacking = useMemo(() => orders.filter((o) => o.status === 'en_armado' && !o.archived), [orders]);
  const mineCount = inPacking.filter((o) => o.assignedPackerId === uid).length;
  const [onlyMine, setOnlyMine] = useState(mineCount > 0);
  const list = onlyMine ? inPacking.filter((o) => o.assignedPackerId === uid) : inPacking;
  const rows = useMemo(() => pickingTotals(list), [list]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const print = usePrintOrders();
  const [printerOpen, setPrinterOpen] = useState(false);
  const toggle = (k: string) => setChecked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <Backdrop onClose={onClose} label="Total en armado">
      <div className={SHEET_PANEL + ' sm:max-w-lg'} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase">Total en armado</h2>
            <p className="text-xs text-charcoal-500">{list.length} pedido{list.length === 1 ? '' : 's'} · {rows.length} producto{rows.length === 1 ? '' : 's'} · marque lo que ya sacó</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-charcoal-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="flex gap-1.5 mt-3">
          <button onClick={() => setOnlyMine(true)} className={'rounded-md border px-2.5 py-1 text-xs ' + (onlyMine ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-600')}>Los que tomé ({mineCount})</button>
          <button onClick={() => setOnlyMine(false)} className={'rounded-md border px-2.5 py-1 text-xs ' + (!onlyMine ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-600')}>Todos en armado ({inPacking.length})</button>
        </div>
        {rows.length === 0 ? <p className="text-sm text-charcoal-400 mt-4">{onlyMine ? 'No tiene pedidos tomados. Tome pedidos de «Pendiente» y vuelva acá.' : 'No hay pedidos en armado.'}</p> : (
          <ul className="card divide-y divide-charcoal-100 mt-3">
            {rows.map((r) => (
              <li key={r.key}>
                <label className={'flex items-center gap-3 px-3 py-2.5 cursor-pointer ' + (checked.has(r.key) ? 'opacity-50' : '')}>
                  <input type="checkbox" checked={checked.has(r.key)} onChange={() => toggle(r.key)} className="w-5 h-5 accent-charcoal-900" />
                  <span className="min-w-0 flex-1">
                    <span className={'block text-sm text-charcoal-900 ' + (checked.has(r.key) ? 'line-through' : '')}>{r.productName}{r.sample && <span className="ml-1 text-[10px] uppercase tracking-display text-brass-700">muestra</span>}</span>
                    <span className="block text-[11px] text-charcoal-400">{r.formatLabel} · {r.orders} pedido{r.orders === 1 ? '' : 's'}{r.pendingQty > 0 && <span className="text-red-700"> · faltan {formatQty(r.pendingQty, r.unit)} de producción</span>}</span>
                  </span>
                  <span className="shrink-0 text-base font-semibold text-charcoal-900 tabular-nums">{formatQty(r.qty, r.unit)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
          <Button className="flex-1" disabled={list.length === 0} onClick={() => print([...list].sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || (a.deliveryWindow?.from ?? '99').localeCompare(b.deliveryWindow?.from ?? '99')))}>Imprimir comandas ({list.length})</Button>
        </div>
        <button type="button" onClick={() => setPrinterOpen(true)} className="block mx-auto mt-2 text-[11px] underline text-charcoal-500">Configurar impresora</button>
        {printerOpen && <PrinterSettingsDialog sample={list[0]} onClose={() => setPrinterOpen(false)} />}
      </div>
    </Backdrop>
  );
}
