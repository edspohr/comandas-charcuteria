import { itemLines, noteLines, wrap, type TicketRow } from '@/domain/ticket';

// ESC/POS mínimo para térmicas genéricas de 58/80 mm, enviado a la app RawBT
// del tablet Android (rawbt:base64,…). Tildes y ñ en la página de códigos
// PC850 (ESC t 2), que traen casi todas; si la impresora muestra signos
// raros, la configuración «Sin tildes» las reemplaza por letras simples.

const ESC = 0x1b, GS = 0x1d;

const PC850: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8, 'º': 0xa7, 'ª': 0xa6,
};
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿¡]/g, '');

function encode(text: string, accents: boolean): number[] {
  const src = accents ? text : plain(text);
  const out: number[] = [];
  for (const ch of src.replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/→/g, '>')) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out.push(c);
    else if (accents && PC850[ch] != null) out.push(PC850[ch]);
    else out.push(...plain(ch).split('').map((x) => (x.charCodeAt(0) < 0x80 ? x.charCodeAt(0) : 0x3f)));
  }
  return out;
}

export interface EscPosOptions { width: number; accents: boolean; cut: boolean }

export function ticketsToEscPos(tickets: TicketRow[][], opts: EscPosOptions): Uint8Array {
  const b: number[] = [];
  const cmd = (...x: number[]) => b.push(...x);
  const line = (t: string) => { b.push(...encode(t, opts.accents), 0x0a); };
  cmd(ESC, 0x40);                 // init
  if (opts.accents) cmd(ESC, 0x74, 2); // PC850
  tickets.forEach((rows, ti) => {
    for (const r of rows) {
      if (r.kind === 'rule') { cmd(ESC, 0x61, 0); line('-'.repeat(opts.width)); continue; }
      if (r.kind === 'title') { cmd(ESC, 0x61, 1, GS, 0x21, 0x11, ESC, 0x45, 1); wrap(r.text, Math.floor(opts.width / 2)).forEach(line); cmd(GS, 0x21, 0, ESC, 0x45, 0); continue; }
      if (r.kind === 'big') { cmd(ESC, 0x61, 0, GS, 0x21, 0x01, ESC, 0x45, 1); wrap(r.text, opts.width).forEach(line); cmd(GS, 0x21, 0, ESC, 0x45, 0); continue; }
      if (r.kind === 'text') { cmd(ESC, 0x61, r.center ? 1 : 0, ESC, 0x45, r.bold ? 1 : 0); wrap(r.text, opts.width).forEach(line); cmd(ESC, 0x45, 0); continue; }
      cmd(ESC, 0x61, 0, ESC, 0x45, 1);
      itemLines(r.qty, r.text, opts.width).forEach((t, i) => { if (i === 1) cmd(ESC, 0x45, 0); line(t); });
      cmd(ESC, 0x45, 0);
      if (r.note) noteLines(r.note, opts.width).forEach(line);
    }
    cmd(ESC, 0x61, 0);
    b.push(0x0a, 0x0a, 0x0a, 0x0a);
    if (opts.cut) cmd(GS, 0x56, 0x42, 0x00); // partial cut with feed
    else if (ti < tickets.length - 1) line('');
  });
  return new Uint8Array(b);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
