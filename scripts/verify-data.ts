import { products } from './data/products.ts';
import { clients } from './data/clients.ts';
import { users } from './data/users.ts';
import { weekOrders } from './data/orders-week.ts';

const errs: string[] = [];
const productMap = new Map(products.map((p) => [p.id, p]));
const clientMap = new Map(clients.map((c) => [c.id, c]));
const userMap = new Map(users.map((u) => [u.uid, u]));

for (const o of weekOrders) {
  if (!clientMap.has(o.clientId)) errs.push(`${o.id}: clientId ${o.clientId} missing`);
  if (!userMap.has(o.createdBy)) errs.push(`${o.id}: createdBy ${o.createdBy} missing`);
  for (const l of o.lines) {
    const prod = productMap.get(l.productId);
    if (!prod) { errs.push(`${o.id}: product ${l.productId} missing`); continue; }
    if (!prod.formats.find((f) => f.formatId === l.formatId)) {
      errs.push(`${o.id}: format ${l.formatId} missing on ${l.productId}`);
    }
    if (l.reservedQty + l.pendingProductionQty > l.qty) {
      errs.push(`${o.id} ${l.productId}: reserved+pending > qty`);
    }
  }
}

const statuses = [...new Set(weekOrders.map((o) => o.status))].sort();
console.log(`products: ${products.length}, clients: ${clients.length}, users: ${users.length}, orders: ${weekOrders.length}`);
console.log(`statuses: ${statuses.join(', ')}`);
if (errs.length) {
  console.error(`\n❌ ${errs.length} errors:\n  ${errs.join('\n  ')}`);
  process.exit(1);
}
console.log('✅ seed data OK');
