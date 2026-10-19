// Sondeo de la API real de Bsale: solo GET, 2 filas por recurso. Sirve para
// verificar los nombres de campos que asume functions/src/bsale/api.ts antes
// de correr el diagnóstico completo. Escribe private/bsale-probe.json (fuera
// del repo: trae datos de clientes).
//
//   BSALE_ACCESS_TOKEN=$(gcloud secrets versions access latest --secret=BSALE_ACCESS_TOKEN --project=comandas-charcuteria) \
//   npx tsx scripts/bsale-probe.ts

import { mkdirSync, writeFileSync } from 'node:fs';

const token = process.env.BSALE_ACCESS_TOKEN;
if (!token || token === 'pendiente') { console.error('Falta BSALE_ACCESS_TOKEN (o sigue en "pendiente").'); process.exit(1); }
const BASE = process.env.BSALE_BASE_URL ?? 'https://api.bsale.io';

const PATHS = [
  '/v1/offices.json',
  '/v1/document_types.json',
  '/v1/price_lists.json',
  '/v1/product_types.json',
  '/v1/products.json?expand=[product_type]',
  '/v1/variants.json?expand=[product]',
  '/v1/stocks.json?expand=[variant,office]',
  '/v1/clients.json',
  '/v1/users.json',
  '/v1/shipping_types.json',
  '/v1/documents.json?expand=[details,client,document_type,sellers,office,references]',
];

async function get(path: string) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}limit=2`, { headers: { access_token: token!, accept: 'application/json' } });
  const text = await res.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: res.status, body };
}

async function main() {
  const out: Record<string, unknown> = { at: new Date().toISOString(), base: BASE };
  for (const p of PATHS) {
    const r = await get(p);
    const b = r.body as { count?: number; items?: unknown[] };
    out[p] = r;
    console.log(`${String(r.status).padEnd(4)} ${p}  count=${b?.count ?? '?'} items=${Array.isArray(b?.items) ? b.items.length : '?'}`);
  }
  // Price list detail for the first list, if any.
  const pl = (out['/v1/price_lists.json'] as { body?: { items?: Array<{ id: number }> } })?.body?.items?.[0];
  if (pl) { const p = `/v1/price_lists/${pl.id}/details.json`; const r = await get(p); out[p] = r; console.log(`${String(r.status).padEnd(4)} ${p}`); }
  mkdirSync('private', { recursive: true });
  writeFileSync('private/bsale-probe.json', JSON.stringify(out, null, 2));
  console.log('→ private/bsale-probe.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
