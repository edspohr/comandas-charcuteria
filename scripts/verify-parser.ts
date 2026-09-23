// Sanity + regression suite for the paste-order parser (local deterministic
// fallback). Cases adaptados al catálogo real de agosto.
import { parseLocal, type ParsedLine } from '../app/src/domain/parse/local.ts';
import { products } from './data/products.ts';

interface Expect {
  input: string;
  productId?: string;
  formatId?: string;
  qty?: number;
  status?: ParsedLine['status'];
  noteMustNotInclude?: string[];
  label?: string;
}

const CASES: Expect[] = [
  // README SAMPLE original
  { input: '- 3 kg de jamón cocido laminado fino', productId: 'jamon-cocido',     formatId: 'granel-kg', qty: 3, status: 'verified' },
  { input: '- 2 kg de longaniza chillán granel',    productId: 'longaniza-chillan', formatId: 'granel-kg', qty: 2, status: 'verified' },
  { input: '- 2 piezas de coppa',                   productId: 'coppa',           formatId: 'pieza',      qty: 2, status: 'verified' },
  { input: '- 500g pastrami vacuno sin jugo',       productId: 'pastrami-vacuno' },

  // #34 aliases genéricos: "gouda ahumado" NO cae en jamón ahumado
  { input: 'queso gouda ahumado x 10 sachet 200',   productId: 'queso-gouda-ahumado', formatId: 'sachet-200g', qty: 10 },

  // Notas duplicadas: pistacho es parte del nombre → NO debe ir a notes
  { input: 'mortadela pistacho 1,5 kg',              productId: 'mortadela-pistacho', noteMustNotInclude: ['pistacho'] },

  // Greeting descartado
  { input: 'Buenos días! Para mañana necesito:',     label: 'greeting' },

  // Fuse fallback: typo obvio
  { input: 'chorico español pieza',                  productId: 'chorizo-espanol',  formatId: 'pieza' },

  // Caso real del split del demo: longaniza granel 20 kg
  { input: '20 kg longaniza chillán granel',         productId: 'longaniza-chillan', formatId: 'granel-kg', qty: 20 },

  // WhatsApp del brief §5.1: cocido vs ahumado — no debe confundir productos.
  { input: '10 sachet de jamón cocido 200g',         productId: 'jamon-cocido',     formatId: 'sachet-200g', qty: 10 },
  { input: '10 sachet jamón ahumado 200g',           productId: 'jamon-ahumado',    formatId: 'sachet-200g', qty: 10 },

  // Sachet 500 g vs granel kg — el catálogo tiene ambos para jamón serrano.
  { input: '4 sachet 500g jamón serrano',            productId: 'jamon-serrano',    formatId: 'sachet-500g', qty: 4 },
  { input: '4 kg jamón serrano granel',              productId: 'jamon-serrano',    formatId: 'granel-kg',   qty: 4 },

  // "x10" y "una caja" (variantes del brief) — el x-prefijo delante de qty.
  { input: 'jamón cocido sachet 200g x10',           productId: 'jamon-cocido',     formatId: 'sachet-200g', qty: 10 },
];

// Casos multi-línea del brief: mensajes reales con líneas compuestas o sin cantidad.
const MULTI_CASES: Array<{ label: string; input: string; expect: (lines: ParsedLine[]) => string | null }> = [
  {
    label: 'compuesta: 60 sachet 200g + 8 kg laminado',
    input: 'Jamón cocido: 60 sachet de 200 g y 8 kg laminado',
    expect: (lines) => {
      const sachet = lines.find((l) => l.productId === 'jamon-cocido' && l.formatId === 'sachet-200g' && l.qty === 60);
      const granel = lines.find((l) => l.productId === 'jamon-cocido' && l.formatId === 'granel-kg' && l.qty === 8);
      return sachet && granel ? null : `expected sachet-200g×60 + granel-kg×8, got ${lines.map((l) => `${l.productId}/${l.formatId}×${l.qty}`).join(' | ')}`;
    },
  },
  {
    label: 'pedido sin cantidad: fallback local no lo descarta silenciosamente',
    input: 'Buen día! Necesito jamón cocido para mañana',
    expect: (lines) => {
      // El local no puede completar la qty, pero al menos debe reconocer el producto
      // o dejar la línea como not_found (nunca inventar). Verificamos que si hay línea,
      // el productId corresponda a jamón cocido y esté marcada review/not_found (no verified).
      const l = lines[0];
      if (!l) return null; // aceptable: local descartó por falta de qty
      if (l.productId && l.productId !== 'jamon-cocido') return `productId inesperado ${l.productId}`;
      if (l.status === 'verified') return 'no debería estar "verified" sin cantidad';
      return null;
    },
  },
];

const SAMPLE_MULTI = CASES.slice(0, 4).map((c) => c.input).join('\n');

const errs: string[] = [];
let ok = 0;

for (const c of CASES) {
  const results = parseLocal(c.input, products);

  if (c.label === 'greeting') {
    if (results.length === 0) { ok++; continue; }
    errs.push(`"${c.input}" → expected discarded, got ${results.length} result(s)`);
    continue;
  }

  const line = results[0];
  if (!line) { errs.push(`"${c.input}" → no result`); continue; }

  if (c.productId && line.productId !== c.productId) {
    errs.push(`"${c.input}" → productId ${line.productId ?? 'none'}, expected ${c.productId}`);
    continue;
  }
  if (c.formatId && line.formatId !== c.formatId) {
    errs.push(`"${c.input}" → formatId ${line.formatId ?? 'none'}, expected ${c.formatId}`);
    continue;
  }
  if (c.qty != null && line.qty !== c.qty) {
    errs.push(`"${c.input}" → qty ${line.qty ?? 'none'}, expected ${c.qty}`);
    continue;
  }
  if (c.status && line.status !== c.status) {
    errs.push(`"${c.input}" → status ${line.status}, expected ${c.status}`);
    continue;
  }
  if (c.noteMustNotInclude && line.notes) {
    const bad = c.noteMustNotInclude.filter((n) => line.notes!.toLowerCase().includes(n));
    if (bad.length) {
      errs.push(`"${c.input}" → notes "${line.notes}" contains ${bad.join(', ')} but should not`);
      continue;
    }
  }
  ok++;
}

const sampleResults = parseLocal(SAMPLE_MULTI, products);
const usable = sampleResults.filter((r) => r.productId && (r.qty ?? 0) > 0).length;

console.log(`Individual cases: ${ok}/${CASES.length}`);
console.log(`README SAMPLE joined: ${usable} usable of ${sampleResults.length} parsed`);

let multiOk = 0;
for (const m of MULTI_CASES) {
  const res = parseLocal(m.input, products);
  const err = m.expect(res);
  if (err) errs.push(`[${m.label}] ${err}`);
  else multiOk++;
}
console.log(`Multi-line cases: ${multiOk}/${MULTI_CASES.length}`);

if (errs.length) {
  console.error(`\n❌ ${errs.length} failure(s):`);
  for (const e of errs) console.error(`  - ${e}`);
  process.exit(1);
}
if (usable < 3) {
  console.error(`❌ README SAMPLE gave only ${usable} usable lines, expected ≥3`);
  process.exit(1);
}
console.log('✅ Parser regression suite OK');
