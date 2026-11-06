import { useState } from 'react';
import Button from '@/components/ui/Button';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { useUsers } from '@/data/users';
import { ticketFor, ticketText } from '@/domain/ticket';
import type { Order } from '@/domain/types';
import { loadPrinter, printTickets, usePrinter, type PrinterSettings } from '@/lib/printer';

// Comandas impresas (Fase 3): botón por pedido, en lote y al tomar.

export function usePrintOrders() {
  const { nameOf } = useUsers();
  return (orders: Order[], settings?: PrinterSettings) =>
    printTickets(orders.map((o) => ticketFor(o, { seller: nameOf(o.createdBy) || '—', packer: o.assignedPackerId ? nameOf(o.assignedPackerId) : undefined })), settings ?? loadPrinter());
}

export function PrintOrderButton({ order, className = '' }: { order: Order; className?: string }) {
  const print = usePrintOrders();
  const [settings, setSettings] = useState(false);
  return (
    <span className={'inline-flex items-center gap-2 ' + className}>
      <Button size="sm" variant="secondary" onClick={() => print([order])}>Imprimir comanda</Button>
      <button type="button" onClick={() => setSettings(true)} className="text-[11px] underline text-charcoal-500">Impresora</button>
      {settings && <PrinterSettingsDialog sample={order} onClose={() => setSettings(false)} />}
    </span>
  );
}

export function PrinterSettingsDialog({ sample, onClose }: { sample?: Order; onClose: () => void }) {
  const [s, setS] = usePrinter();
  const { nameOf } = useUsers();
  const preview = sample ? ticketText(ticketFor(sample, { seller: nameOf(sample.createdBy) || '—', packer: sample.assignedPackerId ? nameOf(sample.assignedPackerId) : undefined }), s.width).join('\n') : null;
  const print = usePrintOrders();
  const opt = (active: boolean) => 'rounded-md border px-2.5 py-1.5 text-xs ' + (active ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-600');
  return (
    <ModalShell title="Impresora de comandas" eyebrow="Este equipo" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <p className="eyebrow mb-1.5">Cómo imprime</p>
          <div className="flex flex-wrap gap-1.5">
            <button className={opt(s.mode === 'rawbt')} onClick={() => setS({ ...s, mode: 'rawbt' })}>Tablet Android con RawBT</button>
            <button className={opt(s.mode === 'navegador')} onClick={() => setS({ ...s, mode: 'navegador' })}>Diálogo del navegador</button>
          </div>
          <p className="text-[11px] text-charcoal-400 mt-1">{s.mode === 'rawbt' ? 'Instale RawBT (Play Store), conecte la térmica por WiFi o Bluetooth en RawBT y haga una prueba. Comandas le manda la comanda con un toque.' : 'Usa la impresora instalada en el equipo. Elija papel de 80 mm (o 58 mm) y sin márgenes.'}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="eyebrow mb-1.5">Papel</p>
            <div className="flex gap-1.5">
              <button className={opt(s.width === 48)} onClick={() => setS({ ...s, width: 48 })}>80 mm</button>
              <button className={opt(s.width === 32)} onClick={() => setS({ ...s, width: 32 })}>58 mm</button>
            </div>
          </div>
          {s.mode === 'rawbt' && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.accents} onChange={(e) => setS({ ...s, accents: e.target.checked })} className="w-4 h-4" /> Tildes y ñ <span className="text-[11px] text-charcoal-400">(apáguelo si salen signos raros)</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.cut} onChange={(e) => setS({ ...s, cut: e.target.checked })} className="w-4 h-4" /> Cortar el papel entre comandas</label>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.autoOnTake} onChange={(e) => setS({ ...s, autoOnTake: e.target.checked })} className="w-4 h-4" /> Imprimir la comanda apenas tomo un pedido</label>
        {preview && (
          <div>
            <p className="eyebrow mb-1.5">Vista previa</p>
            <pre className="card p-3 text-[10px] leading-tight overflow-x-auto bg-white font-mono">{preview}</pre>
          </div>
        )}
        <div className="flex gap-2">
          {sample && <Button variant="secondary" onClick={() => print([sample], s)} className="flex-1">Imprimir prueba</Button>}
          <Button onClick={onClose} className="flex-1">Listo</Button>
        </div>
      </div>
    </ModalShell>
  );
}
