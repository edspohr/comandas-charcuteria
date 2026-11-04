// Timbre electrónico (TED) de un DTE chileno: el PDF417 impreso en facturas y
// guías. Su XML trae el bloque DD con:
//   RE  RUT emisor          TD  tipo de DTE        F   folio
//   FE  fecha de emisión    RR  RUT receptor       RSR razón social receptor
//   MNT monto total         IT1 primer ítem
// No trae el nombre del emisor ni las líneas: esas vienen de la foto.
// Puro y sin dependencias: lo prueban tests/unit/ted.test.ts.

export interface Ted {
  rutEmisor: string;
  tipo: number;
  folio: string;
  fecha?: string;        // YYYY-MM-DD
  rutReceptor?: string;
  razonReceptor?: string;
  monto?: number;
  item1?: string;
}

export const DTE_LABEL: Record<number, string> = {
  33: 'Factura electrónica', 34: 'Factura exenta', 46: 'Factura de compra', 52: 'Guía de despacho',
  56: 'Nota de débito', 61: 'Nota de crédito', 39: 'Boleta', 41: 'Boleta exenta',
};

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : undefined;
}

export function looksLikeTed(text: string): boolean {
  return /<TED[\s>]/.test(text) || (/<DD>/.test(text) && /<RE>/.test(text));
}

export function parseTed(text: string): Ted | null {
  if (!looksLikeTed(text)) return null;
  const dd = text.match(/<DD>([\s\S]*?)<\/DD>/)?.[1] ?? text;
  const rutEmisor = tag(dd, 'RE');
  const tipo = Number(tag(dd, 'TD'));
  const folio = tag(dd, 'F');
  if (!rutEmisor || !Number.isFinite(tipo) || !folio) return null;
  const monto = Number(tag(dd, 'MNT'));
  const fe = tag(dd, 'FE');
  return {
    rutEmisor,
    tipo,
    folio: folio.replace(/^0+/, '') || folio,
    fecha: fe && /^\d{4}-\d{2}-\d{2}$/.test(fe) ? fe : undefined,
    rutReceptor: tag(dd, 'RR'),
    razonReceptor: tag(dd, 'RSR'),
    monto: Number.isFinite(monto) ? monto : undefined,
    item1: tag(dd, 'IT1'),
  };
}
