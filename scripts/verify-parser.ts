// Sanity + regression suite for the paste-order parser.
// Covers the README sample + specific cases raised in the QA report (#4, #34).
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
  // README SAMPLE (paste it as one message split into 4 lines)
  { input: '- 3 kg de jamón cocido laminado fino', productId: 'jamon-cocido', formatId: 'granel-kg', qty: 3, status: 'verified' },
  { input: '- 12 sachet 500g longaniza chillán',    productId: 'longaniza-chillan', formatId: 'sachet-500g', qty: 12, status: 'verified' },
  { input: '- 2 piezas de coppa',                   productId: 'coppa', formatId: 'pieza', qty: 2, status: 'verified' },
  { input: '- 500g pastrami vacuno sin jugo',       productId: 'pastrami-vacuno' },  // format is fuzzy, focus on product

  // #34 aliases genéricos: "gouda ahumado" NO debe caer en jamón ahumado.
  { input: 'gouda ahumado x 10 sachet 200',  productId: 'gouda-ahumado', formatId: 'sachet-200g', qty: 10 },

  // #34 formato pote: "5 potes pate de hongos 250" → pote-250g, no pote-150g.
  { input: '5 potes pate de hongos 250',     productId: 'pate-hongos', formatId: 'pote-250g', qty: 5 },

  // #34 notas duplicadas: pistacho está en el nombre del producto → no debe ir a notes.
  { input: 'mortadela pistacho 1,5 kg',       productId: 'mortadela-pistacho', noteMustNotInclude: ['pistacho'] },

  // Wizard demo split step: Longaniza 20 sachet 5 kg → sachet-5kg qty 20
  { input: '20 sachet 5 kg longaniza chillán', productId: 'longaniza-chillan', formatId: 'sachet-5kg', qty: 20 },

  // Greeting should be discarded, not proposed as not_found
  { input: 'Buenos días! Para mañana necesito:', label: 'greeting' },

  // Fuse fallback: obvious typo
  { input: 'chorico español pieza',           productId: 'chorizo-espanol', formatId: 'pieza' },
];

const SAMPLE_MULTI = CASES.slice(0, 4).map((c) => c.input).join('\n');

// Parse each single-line case (Test isolation from SAMPLE-level splitBlocks).
const errs: string[] = [];
let ok = 0;

for (const c of CASES) {
  const results = parseLocal(c.input, products);

  // Greetings are filtered inside splitBlocks — they should produce no line at all.
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

// SAMPLE integration check: at least 4 usable lines from the joined README sample.
const sampleResults = parseLocal(SAMPLE_MULTI, products);
const usable = sampleResults.filter((r) => r.productId && (r.qty ?? 0) > 0).length;

console.log(`Individual cases: ${ok}/${CASES.length}`);
console.log(`README SAMPLE joined: ${usable} usable of ${sampleResults.length} parsed`);

if (errs.length) {
  console.error(`\n❌ ${errs.length} failure(s):`);
  for (const e of errs) console.error(`  - ${e}`);
  process.exit(1);
}
if (usable < 4) {
  console.error(`❌ README SAMPLE gave only ${usable} usable lines, expected ≥4`);
  process.exit(1);
}
console.log('✅ Parser regression suite OK');
