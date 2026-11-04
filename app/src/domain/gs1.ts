// Intérprete de etiquetas GS1 (GS1-128, GS1 DataBar, GS1 DataMatrix) y de
// EAN-13 de peso variable. Recibe el texto que entrega el lector de códigos
// en cualquiera de sus formas:
//   - con separador de grupo (␝, 0x1D) y prefijo de simbología (]C1, ]d2, ]e0);
//   - en texto legible «(01)07801234567890(3102)001250(10)L123»;
//   - sin separadores: solo se corta bien cuando los campos variables van al final.
// Puro y sin dependencias: lo prueban tests/unit/gs1.test.ts.

export interface Gs1Label {
  kind: 'gs1' | 'peso_variable' | 'ean' | 'otro';
  /** Clave para recordar el insumo: GTIN (01/02), EAN, o el prefijo del peso variable. */
  code?: string;
  gtin?: string;
  netKg?: number;
  grossKg?: number;
  /** El peso vino de un EAN de peso variable: la posición es supuesta, confirmar. */
  weightAssumed?: boolean;
  lot?: string;
  serial?: string;
  prodDate?: string;   // YYYY-MM-DD
  packDate?: string;
  bestBefore?: string;
  expiry?: string;
  count?: number;
  ais: Record<string, string>;
  raw: string;
}

const GS = '\u001d';

// Largo de cada AI y de su valor: fijo, o variable hasta ␝ o el final del
// texto (con un máximo). Solo los AI que aparecen en cajas de alimentos.
function aiAt(s: string): { ai: string; fixed?: number; max?: number } | null {
  if (!/^\d{2}/.test(s)) return null;
  const two = s.slice(0, 2); const three = s.slice(0, 3); const four = s.slice(0, 4);
  if (two === '00') return { ai: two, fixed: 18 };
  if (two === '01' || two === '02') return { ai: two, fixed: 14 };
  if (/^1[1-7]$/.test(two)) return { ai: two, fixed: 6 };
  if (two === '10' || two === '21' || two === '22') return { ai: two, max: 20 };
  if (two === '20') return { ai: two, fixed: 2 };
  if (two === '30' || two === '37') return { ai: two, max: 8 };
  if (/^9\d$/.test(two)) return { ai: two, max: 90 };
  if (/^41[0-7]$/.test(three)) return { ai: three, fixed: 13 };
  if (/^(24[01]|25[01]|4[02]\d)$/.test(three)) return { ai: three, max: 30 };
  if (!/^\d{4}$/.test(four)) return null;
  if (/^3[1-6]\d\d$/.test(four)) return { ai: four, fixed: 6 };
  if (/^39[0-3]\d$/.test(four)) return { ai: four, max: 15 };
  if (four === '8005') return { ai: four, fixed: 6 };
  if (/^7\d{3}$/.test(four)) return { ai: four, max: 30 };
  return null;
}

function normalize(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\][A-Za-z]\d/, '');          // ]C1, ]e0, ]d2, ]Q3
  s = s.replace(/[èñ]/g, GS);        // FNC1 mal traducido por algunos lectores
  s = s.replace(/<GS>|\{GS\}|␝|\\x1d|\^\]/gi, GS);
  if (s.startsWith(GS)) s = s.slice(1);
  return s;
}

function parseHri(s: string): Record<string, string> | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null;
  const out: Record<string, string> = {};
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].trim();
  return out;
}

function parseElementString(s: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const head = aiAt(s.slice(i));
    if (!head) return Object.keys(out).length ? out : null;
    i += head.ai.length;
    if (head.fixed) {
      const v = s.slice(i, i + head.fixed);
      if (v.length < head.fixed) return Object.keys(out).length ? out : null;
      out[head.ai] = v;
      i += head.fixed;
    } else {
      const end = s.indexOf(GS, i);
      const stop = end === -1 ? s.length : end;
      out[head.ai] = s.slice(i, Math.min(stop, i + (head.max ?? 90)));
      i = Math.min(stop, i + (head.max ?? 90));
    }
  }
  return out;
}

// YYMMDD → YYYY-MM-DD. DD = 00 significa el último día del mes.
export function gs1Date(v: string | undefined): string | undefined {
  if (!v || !/^\d{6}$/.test(v)) return undefined;
  const yy = Number(v.slice(0, 2)); const mm = Number(v.slice(2, 4)); let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  const yyyy = 2000 + yy;
  if (dd === 0) dd = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const decimal = (ai: string, v: string) => Number(v) / 10 ** Number(ai[3]);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function eanCheckOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function parseLabel(raw: string, format?: string): Gs1Label {
  const s = normalize(raw);
  const base: Gs1Label = { kind: 'otro', ais: {}, raw };

  // EAN/UPC sueltos.
  if (/^\d{8}$|^\d{12,13}$/.test(s) && (!format || /EAN|UPC/i.test(format))) {
    const ean = s.length === 12 ? `0${s}` : s;
    if (ean.length === 13 && ean.startsWith('2')) {
      // Peso variable: 2 + código del producto (6) + peso en gramos (5) + verificador.
      // Es la configuración más común de balanzas en Chile; se confirma a mano.
      const grams = Number(ean.slice(7, 12));
      return { ...base, kind: 'peso_variable', code: ean.slice(0, 7), netKg: grams > 0 ? round3(grams / 1000) : undefined, weightAssumed: true };
    }
    return { ...base, kind: 'ean', code: ean, gtin: ean.padStart(14, '0') };
  }

  const ais = parseHri(s) ?? (/^\d{2}/.test(s) ? parseElementString(s) : null);
  if (!ais || !(ais['01'] || ais['02'] || Object.keys(ais).some((k) => /^3[1-6]/.test(k)))) {
    return { ...base, code: s.length <= 40 ? s : undefined };
  }

  const label: Gs1Label = { ...base, kind: 'gs1', ais };
  label.gtin = ais['01'] ?? ais['02'];
  label.code = label.gtin;
  for (const [ai, v] of Object.entries(ais)) {
    if (!/^\d+$/.test(v)) continue;
    if (/^310\d$/.test(ai)) label.netKg = round3(decimal(ai, v));
    else if (/^320\d$/.test(ai) && label.netKg == null) label.netKg = round3(decimal(ai, v) * 0.45359237);
    else if (/^330\d$/.test(ai)) label.grossKg = round3(decimal(ai, v));
    else if (/^340\d$/.test(ai) && label.grossKg == null) label.grossKg = round3(decimal(ai, v) * 0.45359237);
  }
  label.lot = ais['10'] || undefined;
  label.serial = ais['21'] || undefined;
  label.prodDate = gs1Date(ais['11']);
  label.packDate = gs1Date(ais['13']);
  label.bestBefore = gs1Date(ais['15']);
  label.expiry = gs1Date(ais['17']) ?? label.bestBefore;
  const count = ais['30'] ?? ais['37'];
  if (count && /^\d+$/.test(count)) label.count = Number(count);
  return label;
}

// Para mostrar el texto crudo: el ␝ invisible queda a la vista.
export const visibleRaw = (raw: string) => raw.replace(/\u001d/g, '␝');
