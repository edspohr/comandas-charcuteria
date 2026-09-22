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
