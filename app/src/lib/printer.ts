import { useEffect, useState } from 'react';
import { ticketText, type TicketRow } from '@/domain/ticket';
import { ticketsToEscPos, toBase64 } from './escpos';

// Impresora de comandas (Fase 3, visita del 05-11). La configuración es por
// equipo (el tablet de armado), así que vive en el almacenamiento local.
//   rawbt     → tablet Android con la app RawBT y una térmica ESC/POS
//               (WiFi o Bluetooth): imprime con un toque, sin diálogo.
//   navegador → cualquier impresora instalada: diálogo de impresión, 80 mm.

export interface PrinterSettings {
  mode: 'rawbt' | 'navegador';
  width: 48 | 32;          // 80 mm = 48 caracteres; 58 mm = 32
  accents: boolean;        // PC850; apagar si salen signos raros
  cut: boolean;            // corte automático entre comandas
  autoOnTake: boolean;     // imprimir al tomar un pedido
}

const KEY = 'comandas:printer';
export const DEFAULT_PRINTER: PrinterSettings = { mode: 'rawbt', width: 48, accents: true, cut: true, autoOnTake: false };
const EVENT = 'comandas:printer-changed';

export function loadPrinter(): PrinterSettings {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...DEFAULT_PRINTER, ...JSON.parse(raw) } : DEFAULT_PRINTER; } catch { return DEFAULT_PRINTER; }
}

export function savePrinter(s: PrinterSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: vale solo por ahora */ }
  window.dispatchEvent(new Event(EVENT));
}

export function usePrinter(): [PrinterSettings, (s: PrinterSettings) => void] {
  const [s, setS] = useState(loadPrinter);
  useEffect(() => {
    const on = () => setS(loadPrinter());
    window.addEventListener(EVENT, on); window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return [s, (n) => { setS(n); savePrinter(n); }];
}

export function printTickets(tickets: TicketRow[][], s: PrinterSettings = loadPrinter()) {
  if (!tickets.length) return;
  if (s.mode === 'rawbt') {
    const b64 = toBase64(ticketsToEscPos(tickets, { width: s.width, accents: s.accents, cut: s.cut }));
    window.location.href = `rawbt:base64,${b64}`;
    return;
  }
  printInBrowser(tickets, s.width);
}

function printInBrowser(tickets: TicketRow[][], width: number) {
  const root = document.createElement('div');
  root.id = 'ticket-print';
  for (const t of tickets) {
    const pre = document.createElement('pre');
    pre.textContent = ticketText(t, width).join('\n');
    root.appendChild(pre);
  }
  const style = document.createElement('style');
  style.textContent = `
    #ticket-print { display: none; }
    @media print {
      @page { size: ${width === 48 ? 80 : 58}mm auto; margin: 3mm; }
      body > *:not(#ticket-print) { display: none !important; }
      #ticket-print { display: block; }
      #ticket-print pre { font: ${width === 48 ? 11 : 10}px/1.25 ui-monospace, Menlo, Consolas, monospace; color: #000; margin: 0; white-space: pre; break-after: page; }
      #ticket-print pre:last-child { break-after: auto; }
    }`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => { root.remove(); style.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { window.print(); setTimeout(cleanup, 60_000); }, 50);
}
