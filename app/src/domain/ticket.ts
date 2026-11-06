import type { Order } from './types';
import { sampleLabel } from './samples';
import { windowTimes } from './delivery';
import { formatQty } from '@/lib/format';

// Comanda impresa para pegar en el paquete (visita del 05-11, Fase 3): una
// por pedido, en texto de ancho fijo para una térmica de 80 mm (48
// caracteres) o 58 mm (32). La misma estructura sirve para ESC/POS (RawBT) y
// para imprimir desde el navegador.

export type TicketRow =
  | { kind: 'title'; text: string }          // grande y centrado
  | { kind: 'big'; text: string }            // doble alto, negrita
  | { kind: 'text'; text: string; bold?: boolean; center?: boolean }
  | { kind: 'rule' }
  | { kind: 'item'; qty: string; text: string; note?: string };

const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${WEEKDAY[dt.getUTCDay()]} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
}

export function ticketFor(o: Order, names: { seller: string; packer?: string }, now = new Date()): TicketRow[] {
  const client = o.clientSnapshot.fantasyName ?? o.clientSnapshot.name;
  const when = [dayLabel(o.requestedDate), windowTimes(o.deliveryWindow) || o.deliveryWindow?.note || o.receivingHours || '', o.deliveryMode === 'retiro' ? 'RETIRO' : 'DESPACHO'].filter(Boolean).join(' · ');
  const rows: TicketRow[] = [
    { kind: 'text', text: 'LA CHARCUTERIA ARTESANAL', center: true },
    { kind: 'title', text: o.id.replace(/^PED-\d{4}-/, '#') },
    { kind: 'big', text: client },
  ];
  if (o.clientSnapshot.fantasyName && o.clientSnapshot.fantasyName !== o.clientSnapshot.name) rows.push({ kind: 'text', text: o.clientSnapshot.name });
  rows.push({ kind: 'text', text: when, bold: true });
  if (o.deliveryWindow?.note && windowTimes(o.deliveryWindow)) rows.push({ kind: 'text', text: o.deliveryWindow.note });
  if (o.deliveryMode !== 'retiro' && o.deliveryAddress) rows.push({ kind: 'text', text: o.deliveryAddress });
  rows.push({ kind: 'text', text: `Vendedor: ${names.seller}${names.packer ? ` · Arma: ${names.packer}` : ''}` });
  if (o.changeNotice) rows.push({ kind: 'text', text: '*** PEDIDO MODIFICADO ***', bold: true, center: true });
  rows.push({ kind: 'rule' });
  for (const l of o.lines) {
    if (l.shortReason) continue;
    const q = l.sample ? sampleLabel(l) : formatQty(l.qty, l.unit);
    rows.push({ kind: 'item', qty: q, text: `${l.sample ? 'MUESTRA ' : ''}${l.productName} · ${l.formatLabel}`, ...(l.notes ? { note: l.notes } : {}) });
  }
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'text', text: `${o.lines.filter((l) => !l.shortReason).length} producto(s) · impreso ${now.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Santiago' })}`, center: true });
  return rows;
}

// Texto plano con ancho fijo (lo usan ESC/POS y la vista previa).
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else { out.push(line); line = word; }
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    out.push(line);
  }
  return out;
}

// "[ ] 2 u    Coppa · 500 g" con sangría para las líneas que siguen.
const HEAD = 13; // "[ ] " + 8 de cantidad + espacio
export function itemLines(qty: string, text: string, width: number): string[] {
  const head = `[ ] ${qty.padEnd(8)} `;
  const body = wrap(text, Math.max(8, width - head.length));
  return body.map((b, i) => (i === 0 ? head : ' '.repeat(head.length)) + b);
}

// Nota de la línea, alineada bajo el nombre del producto.
export function noteLines(note: string, width: number): string[] {
  return wrap(`> ${note}`, Math.max(8, width - HEAD)).map((l) => ' '.repeat(HEAD) + l);
}

// Vista en texto plano (vista previa y navegador). Título y cliente en
// mayúsculas para que se distingan sin formato.
export function ticketText(rows: TicketRow[], width: number): string[] {
  const out: string[] = [];
  const center = (t: string) => ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
  for (const r of rows) {
    if (r.kind === 'rule') out.push('-'.repeat(width));
    else if (r.kind === 'title') wrap(r.text, width).forEach((t) => out.push(center(t)));
    else if (r.kind === 'big') wrap(r.text.toUpperCase(), width).forEach((t) => out.push(t));
    else if (r.kind === 'text') wrap(r.text, width).forEach((t) => out.push(r.center ? center(t) : t));
    else { out.push(...itemLines(r.qty, r.text, width)); if (r.note) out.push(...noteLines(r.note, width)); }
  }
  return out;
}
