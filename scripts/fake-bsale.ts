// Bsale falso para desarrollo: imita las rutas y formatos de la API real
// (https://docs.bsale.dev) con datos derivados del catálogo y clientes de la
// seed, para probar diagnóstico, sincronización, webhooks y escrituras sin el
// token real.
//
//   npx tsx scripts/fake-bsale.ts          # http://127.0.0.1:4010
//
// Las Cloud Functions del emulador le apuntan con BSALE_BASE_URL en
// functions/.env.local. Estado en memoria: se reinicia al reiniciar.
// Nombres y descripciones se escriben "a la Bsale" (distintos de los ids de
// la app) para que el cruce de catálogo tenga que trabajar de verdad.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { products } from './data/products.ts';
import { clients as seedClients } from './data/clients.ts';

const PORT = Number(process.env.FAKE_BSALE_PORT ?? 4010);
const FACTORY = 1;
const STORE = 2;

const offices = [
  { id: FACTORY, name: 'Casa Matriz Franklin', address: 'Franklin 741', municipality: 'Santiago', city: 'Santiago', isVirtual: 0, state: 0 },
  { id: STORE, name: 'Tienda Franklin', address: 'Franklin 741 local B1', municipality: 'Santiago', city: 'Santiago', isVirtual: 0, state: 0 },
  { id: 3, name: 'Bodega virtual web', isVirtual: 1, state: 0 },
];
const documentTypes = [
  { id: 1, name: 'FACTURA ELECTRÓNICA', codeSii: '33', isElectronicDocument: 1, state: 0 },
  { id: 2, name: 'BOLETA ELECTRÓNICA', codeSii: '39', isElectronicDocument: 1, state: 0 },
  { id: 3, name: 'GUÍA DE DESPACHO ELECTRÓNICA', codeSii: '52', isElectronicDocument: 1, state: 0 },
  { id: 4, name: 'NOTA DE CRÉDITO ELECTRÓNICA', codeSii: '61', isElectronicDocument: 1, state: 0 },
];
const priceLists = [{ id: 1, name: 'Lista Mayorista', state: 0 }, { id: 2, name: 'Lista Tienda', state: 0 }];
const productTypes = [...new Set(products.map((p) => p.category))].map((c, i) => ({ id: i + 1, name: c.toUpperCase(), state: 0 }));
const users = [
  { id: 1, firstName: 'Miguel', lastName: 'Orsini', email: 'miguel@lacharcuteriartesanal.cl', state: 0, office: { id: FACTORY } },
  { id: 2, firstName: 'Rafael', lastName: 'Vendedor', email: 'rafael@lacharcuteriartesanal.cl', state: 0, office: { id: FACTORY } },
  { id: 3, firstName: 'Caja', lastName: 'Tienda', email: 'tienda@lacharcuteriartesanal.cl', state: 0, office: { id: STORE } },
];
const shippingTypes = [{ id: 1, name: 'Venta' }, { id: 6, name: 'Traslado interno' }];

// Products & variants: one Bsale product per app product, one variant per format.
const bsProducts: Array<Record<string, unknown>> = [];
const variants: Array<{ id: number; description: string; code: string; barCode: string; state: number; allowDecimal: number; unlimitedStock: number; product: { id: number }; _price: number; _appKey: string }> = [];
let vId = 100;
products.forEach((p, i) => {
  const pid = i + 1;
  bsProducts.push({ id: pid, name: p.name.toUpperCase(), description: '', state: p.discontinued ? 1 : 0, stockControl: 1, classification: 0, product_type: { id: productTypes.find((t) => t.name === p.category.toUpperCase())!.id } });
  for (const f of p.formats) {
    const desc = f.unit === 'kg' ? 'Granel x kg' : f.formatId === 'pieza' ? 'Pieza entera x kg' : `Sachet ${f.grams ?? ''} gr`.replace('  ', ' ');
    variants.push({
      id: ++vId, description: desc, code: `LCA-${String(vId).padStart(4, '0')}`, barCode: `780${String(vId).padStart(9, '0')}`,
      state: 0, allowDecimal: f.unit === 'kg' ? 1 : 0, unlimitedStock: 0, product: { id: pid },
      _price: f.priceCLP ?? f.pricePerKgCLP ?? 0, _appKey: `${p.id}__${f.formatId}`,
    });
  }
});

const stock = new Map<string, number>(); // `${variant}:${office}`
const rnd = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
for (const v of variants) {
  stock.set(`${v.id}:${FACTORY}`, Math.round(rnd(v.id) * 40));
  stock.set(`${v.id}:${STORE}`, Math.round(rnd(v.id * 7) * 8));
}

let clientSeq = 500;
const bsClients = seedClients.filter((c) => !c.isInternalShop).map((c) => ({
  id: ++clientSeq, firstName: c.fantasyName ?? c.name, lastName: '', email: c.email, code: c.rut, phone: c.contactPhone,
  company: c.name, activity: c.giro, address: c.address, city: 'Santiago', municipality: '', companyOrPerson: c.rut ? 1 : 0, state: 0,
}));

let docSeq = 820;
const docs: Array<Record<string, any>> = [];
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
function emit(typeId: number, client: typeof bsClients[number] | null, lines: Array<{ v: typeof variants[number]; q: number }>, office: number, whenS: number, seller = 2, ref?: string) {
  const details = lines.map((l, i) => ({ id: i + 1, quantity: l.q, netUnitValue: Math.round(l.v._price / 1.19), netAmount: Math.round(l.v._price / 1.19 * l.q), totalAmount: Math.round(l.v._price * l.q), variant: { id: l.v.id, code: l.v.code, description: l.v.description } }));
  const total = details.reduce((s, d) => s + d.totalAmount, 0);
  const d = {
    id: docs.length + 1, number: ++docSeq, emissionDate: whenS, generationDate: whenS, totalAmount: total, netAmount: Math.round(total / 1.19), taxAmount: total - Math.round(total / 1.19), state: 0,
    document_type: documentTypes.find((t) => t.id === typeId), office: offices.find((o) => o.id === office),
    client: client ? { id: client.id, code: client.code, company: client.company, firstName: client.firstName } : null,
    sellers: { items: [users.find((u) => u.id === seller)] },
    details: { items: details },
    references: { items: ref ? [{ number: ref, reason: 'Pedido' }] : [] },
  };
  docs.push(d);
  for (const l of lines) stock.set(`${l.v.id}:${office}`, (stock.get(`${l.v.id}:${office}`) ?? 0) - l.q);
  return d;
}
// 24 months of history with a December peak, so the Panel facts (backfill,
// year-over-year, seasonality) have something to chew on. Bsale stores
// emissionDate as the day's midnight (Chile = 03:00/04:00 UTC).
const midnight = (s: number) => Math.floor(s / DAY) * DAY + 3 * 3600;
for (let i = 0; i < 1800; i++) {
  const ago = Math.floor(rnd(i * 1.7) * 730);
  const month = new Date((nowS() - ago * DAY) * 1000).getUTCMonth();
  if (month !== 11 && rnd(i * 5.3) < 0.35) continue; // December sells more
  const store = i % 4 === 3;
  const c = bsClients[Math.floor(rnd(i * 2.1) * bsClients.length)];
  const lines = [0, 1, 2].slice(0, 1 + (i % 3)).map((k) => ({ v: variants[Math.floor(rnd(i * 3 + k) * variants.length)], q: 1 + Math.floor(rnd(i + k) * 5) }));
  emit(store ? 2 : 1, store ? null : c, lines, store ? STORE : FACTORY, midnight(nowS() - ago * DAY), store ? 3 : 1 + (i % 2));
}
// A few credit notes (devoluciones).
for (let i = 0; i < 12; i++) {
  const v = variants[Math.floor(rnd(i * 9.1) * variants.length)];
  emit(4, bsClients[i % bsClients.length], [{ v, q: 1 }], FACTORY, midnight(nowS() - Math.floor(rnd(i * 4.4) * 300) * DAY), 2);
}
// Stock back to positive after the history above.
for (const [k, q] of stock) if (q < 0) stock.set(k, Math.abs(q) % 15);

// ---------- HTTP ----------

const list = <T>(items: T[], q: URLSearchParams, href: string) => {
  const limit = Math.min(Number(q.get('limit') ?? 25), 50);
  const offset = Number(q.get('offset') ?? 0);
  const page = items.slice(offset, offset + limit);
  return { href, count: items.length, limit, offset, items: page, ...(offset + limit < items.length ? { next: `${href}?limit=${limit}&offset=${offset + limit}` } : {}) };
};
const pub = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
const stockRows = (q: URLSearchParams) => {
  const office = q.get('officeid'); const variant = q.get('variantid');
  const rows: unknown[] = [];
  let id = 0;
  for (const v of variants) for (const o of [FACTORY, STORE]) {
    id++;
    if (office && Number(office) !== o) continue;
    if (variant && Number(variant) !== v.id) continue;
    const qty = stock.get(`${v.id}:${o}`) ?? 0;
    rows.push({ id, quantity: qty, quantityReserved: 0, quantityAvailable: qty, variant: { id: v.id, href: `/v1/variants/${v.id}.json` }, office: { id: o } });
  }
  return rows;
};

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = ''; for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

const writesLog: unknown[] = [];

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/v\d/, '');
  const q = url.searchParams;
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers['access_token'] !== process.env.FAKE_BSALE_TOKEN && process.env.FAKE_BSALE_TOKEN) return send(401, { error: 'token inválido' });
  if (!req.headers['access_token']) return send(401, { error: 'falta access_token' });

  if (req.method === 'GET') {
    let m: RegExpMatchArray | null;
    if (path === '/offices.json') return send(200, list(offices, q, path));
    if (path === '/document_types.json') return send(200, list(documentTypes, q, path));
    if (path === '/price_lists.json') return send(200, list(priceLists, q, path));
    if ((m = path.match(/^\/price_lists\/(\d+)\/details\.json$/))) {
      const factor = m[1] === '2' ? 1.15 : 1;
      return send(200, list(variants.map((v, i) => ({ id: i + 1, variantValue: Math.round(v._price * factor / 1.19), variantValueWithTaxes: Math.round(v._price * factor), variant: { id: v.id } })), q, path));
    }
    if (path === '/product_types.json') return send(200, list(productTypes, q, path));
    if (path === '/products.json') return send(200, list(bsProducts, q, path));
    if (path === '/variants.json') return send(200, list(variants.map((v) => ({ ...pub(v), product: { id: v.product.id, name: (bsProducts[v.product.id - 1] as { name: string }).name } })), q, path));
    if ((m = path.match(/^\/variants\/(\d+)\/costs\.json$/))) {
      const v = variants.find((x) => x.id === Number(m![1]));
      if (!v) return send(404, {});
      const cost = v.id % 7 === 0 ? 0 : Math.round(v._price / 1.19 * (0.45 + rnd(v.id) * 0.2));
      return send(200, { href: path, averageCost: cost, totalCost: cost * 10, history: [] });
    }
    if ((m = path.match(/^\/variants\/(\d+)\.json$/))) { const v = variants.find((x) => x.id === Number(m![1])); return v ? send(200, pub(v)) : send(404, {}); }
    if (path === '/users.json') return send(200, list(users, q, path));
    if (path === '/shipping_types.json') return send(200, list(shippingTypes, q, path));
    if (path === '/stocks.json') return send(200, list(stockRows(q), q, path));
    if (path === '/clients.json') return send(200, list(bsClients.filter((c) => !q.has('state') || String(c.state) === q.get('state')), q, path));
    if ((m = path.match(/^\/clients\/(\d+)\.json$/))) { const c = bsClients.find((x) => x.id === Number(m![1])); return c ? send(200, c) : send(404, {}); }
    if (path === '/documents.json') {
      const range = q.get('emissiondaterange')?.match(/\[(\d+),(\d+)\]/);
      const items = docs.filter((d) => !range || (d.emissionDate >= Number(range[1]) && d.emissionDate <= Number(range[2]))).sort((a, b) => b.emissionDate - a.emissionDate);
      return send(200, list(items, q, path));
    }
    if ((m = path.match(/^\/documents\/(\d+)\.json$/))) { const d = docs.find((x) => x.id === Number(m![1])); return d ? send(200, d) : send(404, {}); }
    if (path === '/_fake/writes') return send(200, writesLog);
    return send(404, { error: `ruta no simulada: ${path}` });
  }

  const body = await readBody(req);
  writesLog.push({ at: Date.now(), method: req.method, path, body });
  if (req.method === 'POST' && path === '/stocks/receptions.json') {
    for (const d of body.details ?? []) stock.set(`${d.variantId}:${body.officeId}`, (stock.get(`${d.variantId}:${body.officeId}`) ?? 0) + Number(d.quantity));
    return send(201, { id: writesLog.length, ...body });
  }
  if (req.method === 'POST' && path === '/stocks/consumptions.json') {
    for (const d of body.details ?? []) stock.set(`${d.variantId}:${body.officeId}`, (stock.get(`${d.variantId}:${body.officeId}`) ?? 0) - Number(d.quantity));
    return send(201, { id: writesLog.length, ...body });
  }
  if (req.method === 'POST' && path === '/clients.json') {
    const c = { id: ++clientSeq, state: 0, ...body };
    bsClients.push(c);
    return send(201, c);
  }
  let m: RegExpMatchArray | null;
  if (req.method === 'PUT' && (m = path.match(/^\/clients\/(\d+)\.json$/))) {
    const c = bsClients.find((x) => x.id === Number(m![1]));
    if (!c) return send(404, {});
    Object.assign(c, body, { id: c.id });
    return send(200, c);
  }
  // Document emitted from Comandas (POST /v1/documents.json).
  if (req.method === 'POST' && path === '/documents.json') {
    const client = body.clientId ? bsClients.find((c) => c.id === Number(body.clientId)) ?? null : body.client ? { id: ++clientSeq, ...body.client, state: 0 } : null;
    if (client && !bsClients.some((c) => c.id === client.id)) bsClients.push(client as typeof bsClients[number]);
    const lines = (body.details ?? []).map((d: { variantId: number; quantity: number }) => ({ v: variants.find((v) => v.id === d.variantId)!, q: d.quantity })).filter((l: { v: unknown }) => l.v);
    if (!lines.length) return send(400, { error: 'sin detalles válidos' });
    const d = emit(Number(body.documentTypeId) || 1, client as typeof bsClients[number] | null, lines, body.officeId ?? FACTORY, body.emissionDate ?? nowS(), body.sellerId ?? 2);
    return send(201, { ...d, urlPdf: `https://fake.bsale/${d.id}.pdf` });
  }
  // Fake POS: emits a document so webhooks/linking can be exercised.
  if (req.method === 'POST' && path === '/_fake/emit') {
    const lines = (body.lines ?? []).map((l: { variantId: number; quantity: number }) => ({ v: variants.find((v) => v.id === l.variantId)!, q: l.quantity })).filter((l: { v: unknown }) => l.v);
    const client = bsClients.find((c) => c.code === body.rut) ?? null;
    return send(201, emit(client ? 1 : 2, client, lines, body.officeId ?? FACTORY, nowS(), 1, body.reference));
  }
  return send(404, { error: `escritura no simulada: ${req.method} ${path}` });
}

createServer((req, res) => { handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }); })
  .listen(PORT, '127.0.0.1', () => console.log(`Bsale falso en http://127.0.0.1:${PORT} · ${variants.length} variantes · ${bsClients.length} clientes · ${docs.length} documentos`));
