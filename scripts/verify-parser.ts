// Quick sanity check for the paste-order parser.
// Runs the SAMPLE from PegarPedido against the seeded catalog and prints
// the resulting lines. Exit code 1 if fewer than 4 lines are matched.
import { parseLocal } from '../app/src/domain/parse/local.ts';
import { products } from './data/products.ts';

const SAMPLE = `Buenos días! Para mañana necesito:
- 3 kg de jamón cocido laminado fino
- 12 sachet 500g longaniza chillán
- 2 piezas de coppa
- 500g pastrami vacuno sin jugo`;

const results = parseLocal(SAMPLE, products);
console.log(`Parsed ${results.length} block(s):\n`);
for (const r of results) {
  const line = `[${r.status}]  ${r.raw}`;
  const detail = r.productId
    ? `    → ${r.productName} · ${r.formatLabel} · qty=${r.qty} ${r.unit ?? ''}${r.notes ? ` · notas: ${r.notes}` : ''}`
    : `    → sin match`;
  console.log(line);
  console.log(detail);
}

const matched = results.filter((r) => r.productId && (r.qty ?? 0) > 0).length;
console.log(`\nMatched ${matched}/${results.length} usable lines.`);
if (matched < 4) {
  console.error(`❌ Expected at least 4 usable lines, got ${matched}`);
  process.exit(1);
}
console.log('✅ Parser sanity OK');
