// Importa el historial del grupo de pedidos de WhatsApp (15-09 → 18-10-2026)
// como datos históricos: catálogo ampliado, clientes con su cartera,
// pedidos con su vendedor y el resumen "Su mes en números".
//
//   npx tsx scripts/import-whatsapp.ts <carpeta-con-orders-N.json> --chat <_chat.txt> [--apply]
//
// Sin --apply solo muestra lo que haría. Destino: emuladores si
// FIRESTORE_EMULATOR_HOST está seteado; si no, el proyecto real con
// GOOGLE_APPLICATION_CREDENTIALS. Es re-ejecutable: borra lo importado antes
// (pedidos source=whatsapp) y reescribe con ids estables.
//
// Los JSON vienen de la extracción del chat (no se versionan: traen RUT,
// teléfonos y correos de clientes). Excluye todo lo de FRAN GC.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import type { Client, Order, OrderLine, Product, ProductFormat, Role } from '../app/src/domain/types.ts';

// ---------- entrada ----------

interface RawLine { productId: string; format: 'sachet' | 'granel' | 'pieza' | 'unidad'; qty: number | null; qtyKg?: number | null; sachetGrams?: number | null; notes?: string; raw?: string; issue?: string }
interface RawClient { name?: string; legalName?: string; sede?: string; rut?: string; giro?: string; address?: string; phone?: string; email?: string; contact?: string; receivingHours?: string; isNew?: boolean }
interface RawOrder { ts: string; author: string; kind: 'venta' | 'reposicion'; client: RawClient; requestedDate: string | null; delivery: 'retiro' | 'despacho' | null; lines: RawLine[]; notes?: string; cancelled?: boolean; raw: string }
interface RawEvent { ts: string; author: string; type: string; quote: string; order_hint?: string }
interface Extract { orders: RawOrder[]; consumptions: Array<{ ts: string }>; events: RawEvent[] }

const dir = process.argv[2];
const apply = process.argv.includes('--apply');
const chatPath = process.argv[process.argv.indexOf('--chat') + 1];
if (!dir || !process.argv.includes('--chat') || !chatPath) { console.error('Uso: import-whatsapp.ts <carpeta> --chat <_chat.txt> [--apply]'); process.exit(1); }

const TODAY = '2026-10-19';
const PERIOD = { from: '2026-09-15', to: '2026-10-18' };
const EXCLUDE = /fran\s*gc|edmundo|panchi|78457637/i;
const TZ = '-03:00'; // Chile en sep/oct 2026 (horario de verano)

// ---------- personas ----------

const PEOPLE: Record<string, { uid: string; displayName: string; role: Role }> = {
  'rafael araujo': { uid: 'wa-rafael', displayName: 'Rafael Araujo', role: 'vendedor' },
  'gabriela cabrera': { uid: 'wa-gabriela', displayName: 'Gabriela Cabrera', role: 'vendedor' },
  'ramiro garcia': { uid: 'wa-ramiro', displayName: 'Ramiro García', role: 'vendedor' },
  juan: { uid: 'wa-juan', displayName: 'Juan', role: 'vendedor' },
  'elizabeth terán': { uid: 'wa-elizabeth', displayName: 'Elizabeth Terán', role: 'vendedor' },
  tania: { uid: 'wa-tania', displayName: 'Tania', role: 'vendedor' },
  lucy: { uid: 'wa-lucy', displayName: 'Lucy', role: 'tienda' },
  ciro: { uid: 'wa-ciro', displayName: 'Ciro', role: 'superAdmin' },
  'luis orsini': { uid: 'wa-luis', displayName: 'Luis Orsini', role: 'superAdmin' },
  'miguel orsini': { uid: 'wa-miguel', displayName: 'Miguel Orsini', role: 'admin' },
  edu: { uid: 'wa-edu', displayName: 'Edu', role: 'despacho' },
  morena: { uid: 'wa-morena', displayName: 'Morena', role: 'despacho' },
  yuriy: { uid: 'wa-yuri', displayName: 'Yuri', role: 'produccion' },
};
const personOf = (author: string) => {
  const k = author.toLowerCase().replace(/[^a-záéíóúñ ]/gi, '').replace(/\s+/g, ' ').trim();
  return PEOPLE[k] ?? PEOPLE[k.split(' ')[0]] ?? Object.values(PEOPLE).find((p) => p.displayName.toLowerCase().startsWith(k.split(' ')[0]));
};
// Invitaciones reales que heredan el historial de su placeholder.
const INVITE_LEGACY: Record<string, string> = { 'ciro@lacharcuteriartesanal.cl': 'wa-ciro', 'luisorsini7@gmail.com': 'wa-luis' };

// ---------- catálogo ampliado ----------

const s200 = (price?: number): ProductFormat => ({ formatId: 'sachet-200g', label: 'Sachet 200 g', unit: 'unidad', grams: 200, ...(price ? { priceCLP: price } : {}) });
const kg = (price?: number): ProductFormat => ({ formatId: 'granel-kg', label: 'Granel laminado (kg)', unit: 'kg', ...(price ? { pricePerKgCLP: price } : {}) });
const pza = (avg: number, price?: number): ProductFormat => ({ formatId: 'pieza', label: 'Pieza entera', unit: 'unidad', avgWeightKg: avg, ...(price ? { pricePerKgCLP: price } : {}) });
const un = (label: string, price?: number): ProductFormat => ({ formatId: 'unidad', label, unit: 'unidad', ...(price ? { priceCLP: price } : {}) });
const np = (id: string, name: string, category: string, formats: ProductFormat[], aliases: string[] = []): Product => ({ id, name, category, active: true, discontinued: false, formats, aliases });

// Productos que aparecen en el chat y no estaban en el pricelist transcrito.
// Sin precio cuando no hay referencia: quedan fuera de la valorización.
const NEW_PRODUCTS: Product[] = [
  np('tabla-120', 'Tabla Charcutera 120 g', 'tablas', [un('Tabla 120 g', 4050)]),
  np('tabla-250', 'Tabla Charcutera 250 g', 'tablas', [un('Tabla 250 g', 5000)]),
  np('tocino-ahumado', 'Tocino Ahumado', 'cocidos', [s200(), kg(), un('Trozo 200–300 g')], ['tocino']),
  np('roast-beef', 'Roast Beef', 'cocidos', [s200(), kg(), pza(2)], ['rosbeef', 'roastbeef']),
  np('jamon-pavo', 'Jamón de Pavo', 'cocidos', [s200(), kg()]),
  np('malaya-cerdo', 'Malaya de Cerdo', 'cocidos', [s200(), kg()], ['malaya']),
  np('costillar-ahumado', 'Costillar Ahumado', 'cocidos', [pza(1.5), un('Trozo')], ['costillar']),
  np('recorte-cecinas', 'Recorte de Cecinas', 'cocidos', [un('Bolsa'), kg()], ['despunte']),
  np('mix-madurados', 'Mix Madurados 200 g', 'madurados', [s200(), kg()], ['mix madurado']),
  np('salamin-italiano', 'Salamín Italiano', 'madurados', [un('Pieza pequeña')], ['salamin']),
  np('chistorra-blanca', 'Chistorra Blanca', 'longanizas', [un('Unidad'), kg()]),
  np('salchicha-polaca', 'Salchicha Polaca', 'longanizas', [un('Unidad'), kg()]),
  np('salchicha-gorda', 'Salchicha Gorda', 'longanizas', [un('Unidad')], ['gordas']),
  np('cabanoqueso', 'Snack Cabanoqueso', 'madurados', [un('Unidad')]),
  np('manteca', 'Manteca', 'untables', [un('Unidad')]),
  np('pate-salame', 'Paté de Salame', 'untables', [un('Unidad')]),
  np('pate-pastrami', 'Paté de Pastrami', 'untables', [un('Unidad')]),
  np('untable-madurado', 'Untable de Madurados', 'untables', [un('Unidad')]),
  np('queso-pecorino', 'Queso Pecorino', 'cocidos', [un('Sachet 150 g')]),
];
// Formatos que el chat usa y el pricelist no tenía (precio proporcional).
const EXTRA_FORMATS: Record<string, ProductFormat[]> = {
  chicharron: [{ formatId: 'bolsa-50g', label: 'Bolsa 50 g', unit: 'unidad', grams: 50, priceCLP: 1500 }],
};
// Lo que el chat dice que se dejó de hacer o se vende hasta agotar.
const DISCONTINUED = new Set(['salame-milano']);
const UNTIL_SOLD_OUT = new Set(['pastirma-vacuno', 'bresaola']);

// ---------- utilidades ----------

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const title = (s: string) => s.trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const ms = (ts: string) => Date.parse(ts + TZ);
const isoDay = (t: number) => new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as T;

function resolveFormat(p: Product, line: RawLine): { format: ProductFormat; qty: number; weightKg?: number } {
  const byId = (id: string) => p.formats.find((f) => f.formatId === id);
  const sachets = p.formats.filter((f) => f.unit === 'unidad' && f.grams);
  const units = p.formats.filter((f) => f.unit === 'unidad' && f.formatId !== 'pieza');
  const granel = p.formats.find((f) => f.unit === 'kg');
  const pieza = byId('pieza');
  const q = line.qty ?? null;
  switch (line.format) {
    case 'granel': {
      const kgQty = line.qtyKg ?? q;
      if (granel) return { format: granel, qty: kgQty ?? 1 };
      break;
    }
    case 'pieza': {
      if (pieza) {
        const avg = pieza.avgWeightKg ?? 1.5;
        if (line.qtyKg) return { format: pieza, qty: Math.max(1, Math.round(line.qtyKg / avg)), weightKg: line.qtyKg };
        return { format: pieza, qty: q ?? 1 };
      }
      if (granel && line.qtyKg) return { format: granel, qty: line.qtyKg };
      break;
    }
    case 'sachet': {
      const g = line.sachetGrams ?? undefined;
      const f = (g && sachets.find((x) => x.grams === g)) || sachets.find((x) => x.grams === 200) || sachets[0];
      if (f) return { format: f, qty: q ?? 1 };
      break;
    }
    case 'unidad': {
      // Loose units asked for a product sold in packs ("Sachet 5 unidades"):
      // convert to packs so 50 vienesas = 10 sachets, not 50.
      const single = units.find((x) => !/\d+\s*unidades/i.test(x.label));
      const f = single ?? units[0];
      if (f) {
        const per = Number(f.label.match(/(\d+)\s*unidades/i)?.[1] ?? 1);
        return { format: f, qty: per > 1 && q ? Math.ceil(q / per) : q ?? 1 };
      }
      break;
    }
  }
  // Fallbacks: kg pedido sin granel → primer formato; sin cantidad → 1.
  const f = (line.qtyKg && granel) || units[0] || granel || p.formats[0];
  return { format: f, qty: (f.unit === 'kg' ? line.qtyKg ?? q : q) ?? 1 };
}

function subtotal(f: ProductFormat, qty: number, weightKg?: number): number | undefined {
  if (f.unit === 'kg') return f.pricePerKgCLP ? Math.round(f.pricePerKgCLP * qty) : undefined;
  if (f.formatId === 'pieza' || (f.pricePerKgCLP && !f.priceCLP)) {
    const w = weightKg ?? (f.avgWeightKg ?? 0) * qty;
    return f.pricePerKgCLP && w ? Math.round(f.pricePerKgCLP * w) : undefined;
  }
  return f.priceCLP ? Math.round(f.priceCLP * qty) : undefined;
}

// ---------- main ----------

async function main() {
  const files = readdirSync(dir).filter((f) => /^orders-\d+\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No hay orders-N.json en ${dir}`);
  const parts: Extract[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const seen = new Set<string>();
  const raw: RawOrder[] = [];
  for (const p of parts) for (const o of p.orders) {
    const k = `${o.ts}|${o.author}`;
    if (seen.has(k)) continue; seen.add(k);
    if (EXCLUDE.test(o.raw) || EXCLUDE.test(o.author) || EXCLUDE.test(JSON.stringify(o.client))) continue;
    raw.push(o);
  }
  raw.sort((a, b) => a.ts.localeCompare(b.ts));
  const events = parts.flatMap((p) => p.events ?? []).filter((e) => !EXCLUDE.test(e.author) && !EXCLUDE.test(e.quote));
  const consumptions = parts.reduce((n, p) => n + (p.consumptions?.length ?? 0), 0);

  const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulated && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Falta GOOGLE_APPLICATION_CREDENTIALS');
  initializeApp({ projectId: emulated ? 'comandas-charcuteria-demo' : 'comandas-charcuteria' });
  const db = getFirestore();

  // Catálogo: existentes + nuevos; marcas de discontinuado.
  const existing = new Map((await db.collection('products').get()).docs.map((d) => [d.id, d.data() as Product]));
  const catalog = new Map(existing);
  const newProducts = NEW_PRODUCTS.filter((p) => !existing.has(p.id));
  newProducts.forEach((p) => catalog.set(p.id, p));
  const patchedFormats: Product[] = [];
  for (const [id, extra] of Object.entries(EXTRA_FORMATS)) {
    const p = catalog.get(id);
    if (!p) continue;
    const add = extra.filter((f) => !p.formats.some((x) => x.formatId === f.formatId));
    if (!add.length) continue;
    // New single-unit formats go first so 'unidad' requests pick them.
    const next = { ...p, formats: [...add, ...p.formats] };
    catalog.set(id, next); patchedFormats.push(next);
  }

  // Clientes.
  interface Acc { client: Client; authors: Map<string, number>; orders: number }
  const clients = new Map<string, Acc>();
  const SHOP_ID = 'tienda-la-charcuteria';
  // Variantes del mismo cliente escritas distinto en el chat.
  const ALIASES: Record<string, string> = {
    'bakery': 'bakery-to-go', 'coconut': 'coconut-cafe', 'dossis-cafe': 'dosis-cafe', 'dreams-coffee-lounge-spa': 'dreams-coffee',
    'get-it': 'get-it', 'oven': 'oven-chile', 'nucleo': 'nucleo-studio', 'inversiones-altus': 'altus', 'la-alianza-spa': 'la-alianza',
    'impasto-restobar': 'impasto', 'sofa': 'cafeteria-sofa', 'tio-tomate': 'el-tio-tomate', 'grupo-bread': 'grupo-bread',
  };
  const sedeKey = (sede: string) => slug(sede.split(',')[0].replace(/^\s*(mall|sede)\s+/i, ''));
  const clientKey = (o: RawOrder) => {
    if (o.kind === 'reposicion') return SHOP_ID;
    // Sin cliente en el mensaje: uno por vendedor, para que se vea el hueco.
    if (!o.client?.name && !o.client?.legalName) return `wa-sin-cliente-${personOf(o.author)?.uid.replace('wa-', '') ?? 'x'}`;
    const raw0 = slug(o.client.name || o.client.legalName || 'cliente');
    const base = ALIASES[raw0] ?? raw0;
    return `wa-${base}${o.client.sede ? '-' + sedeKey(o.client.sede) : ''}`;
  };

  const unmapped: string[] = [];
  const issues: Array<{ id: string; raw: string; issue: string }> = [];
  const orders: Order[] = [];
  let n = 0;
  for (const o of raw) {
    const person = personOf(o.author);
    if (!person) { unmapped.push(`autor? ${o.author}`); continue; }
    const id = `WA-${String(++n).padStart(4, '0')}`;
    const cid = clientKey(o);
    const c = o.client ?? {};
    let acc = clients.get(cid);
    if (!acc) {
      const trade = o.kind === 'reposicion' ? 'Tienda' : (c.name || c.legalName) ? title(c.name || c.legalName!) : `Sin cliente indicado (${person.displayName})`;
      const shown = c.sede ? `${trade} · ${title(c.sede)}` : trade;
      acc = {
        client: clean({
          id: cid,
          name: o.kind === 'reposicion' ? 'Tienda La Charcutería' : (c.legalName ? title(c.legalName) : shown),
          fantasyName: shown,
          deliveryMode: 'despacho',
          invoicingComplete: false,
          isInternalShop: o.kind === 'reposicion' || undefined,
          source: 'app',
          createdBy: person.uid,
          createdAt: ms(o.ts),
        }) as Client,
        authors: new Map(), orders: 0,
      };
      clients.set(cid, acc);
    }
    acc.orders++;
    acc.authors.set(person.uid, (acc.authors.get(person.uid) ?? 0) + 1);
    const cl = acc.client;
    if (c.legalName && cl.name === cl.fantasyName) cl.name = title(c.legalName);
    cl.rut ||= c.rut || undefined; cl.giro ||= c.giro || undefined; cl.address ||= c.address || undefined;
    cl.contactPhone ||= c.phone || undefined; cl.email ||= c.email || undefined; cl.receivingHours ||= c.receivingHours || undefined;
    if (c.contact && !cl.notes) cl.notes = `Contacto: ${c.contact}`;
    if (o.delivery === 'retiro') cl.deliveryMode = 'retiro';

    const createdAt = ms(o.ts);
    const requested = o.requestedDate ?? addDays(isoDay(createdAt), 1);
    const open = !o.cancelled && requested >= TODAY;
    const lines: OrderLine[] = [];
    for (const l of o.lines ?? []) {
      const p = catalog.get(l.productId);
      if (!p) { unmapped.push(`${id} ${l.productId}: ${l.raw ?? ''}`); continue; }
      const { format, qty, weightKg } = resolveFormat(p, l);
      const sub = subtotal(format, qty, weightKg);
      const notes = [l.notes, l.qty == null && l.qtyKg == null ? 'sin cantidad en WhatsApp' : '', weightKg ? `≈ ${weightKg} kg` : '', l.sachetGrams && format.unit === 'kg' ? `en sachet de ${l.sachetGrams} g` : ''].filter(Boolean).join(' · ');
      if (l.issue) issues.push({ id, raw: l.raw ?? '', issue: l.issue });
      lines.push(clean({
        productId: p.id, productName: p.name, formatId: format.formatId, formatLabel: format.label, unit: format.unit,
        qty, notes: notes || undefined,
        reservedQty: open ? 0 : qty, pendingProductionQty: open ? qty : 0,
        packedQty: !open && !o.cancelled ? qty : undefined,
        packedWeightKg: !open && !o.cancelled ? weightKg : undefined,
        unitPriceSnapshotCLP: format.priceCLP ?? format.pricePerKgCLP, subtotalCLP: sub,
      }) as OrderLine);
    }
    if (!lines.length) { unmapped.push(`${id} sin líneas: ${o.raw.slice(0, 60)}`); n--; continue; }
    const status: Order['status'] = o.cancelled ? 'anulado' : open ? 'confirmado_parcial' : 'entregado';
    const history: Order['statusHistory'] = [{ status: 'recibido', by: person.uid, at: createdAt, note: 'Pedido por WhatsApp' }];
    if (o.cancelled) history.push({ status: 'anulado', by: person.uid, at: createdAt + 60_000, note: 'Anulado en WhatsApp' });
    else if (open) history.push({ status: 'confirmado_parcial', by: person.uid, at: createdAt, note: 'Sin stock cargado: queda a producción hasta conectar Bsale' });
    else history.push({ status: 'entregado', by: 'wa-sistema', at: Math.max(createdAt, ms(`${requested}T17:00:00`)), note: 'Estado inferido del historial de WhatsApp' });
    orders.push(clean({
      id, kind: o.kind, createdBy: person.uid, clientId: cid,
      clientSnapshot: clean({ name: cl.name, fantasyName: cl.fantasyName, rut: cl.rut, address: cl.address }),
      lines, requestedDate: requested, deliveryMode: (o.delivery ?? cl.deliveryMode ?? 'despacho') as Order['deliveryMode'],
      deliveryAddress: c.address || undefined, receivingHours: c.receivingHours || undefined,
      status, statusHistory: history, source: 'whatsapp', historical: true,
      rawText: [o.raw, o.notes].filter(Boolean).join('\n\n— '), invoicingComplete: !!(cl.rut && cl.giro && cl.address),
      createdAt, updatedAt: history[history.length - 1].at, totalCLP: lines.reduce((s, l) => s + (l.subtotalCLP ?? 0), 0),
    }) as Order);
  }
  for (const acc of clients.values()) {
    const top = [...acc.authors.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && !acc.client.isInternalShop) acc.client.ownerUid = top[0];
    acc.client.invoicingComplete = !!(acc.client.rut && acc.client.giro && acc.client.address);
    acc.client.needsReview = !acc.client.invoicingComplete && !acc.client.isInternalShop;
  }

  // ---------- Su mes en números ----------
  const chatText = readFileSync(chatPath, 'utf8');
  const msgRe = /^\[(\d\d)-(\d\d)-26, (\d\d):\d\d:\d\d\] ([^:]+): ([\s\S]*?)(?=^\[\d\d-\d\d-\d\d, |(?![\s\S]))/gm;
  const msgs: Array<{ hour: number; author: string; text: string }> = [];
  for (const m of chatText.matchAll(msgRe)) if (!EXCLUDE.test(m[4]) && !EXCLUDE.test(m[5])) msgs.push({ hour: Number(m[3]), author: m[4], text: m[5].trim() });
  const byHour = Array.from({ length: 24 }, (_, h) => msgs.filter((m) => m.hour === h).length);
  const live = orders.filter((o) => o.status !== 'anulado');
  const sellerCount = new Map<string, number>();
  for (const o of orders) sellerCount.set(o.createdBy, (sellerCount.get(o.createdBy) ?? 0) + 1);
  const nameOfUid = new Map(Object.values(PEOPLE).map((p) => [p.uid, p.displayName]));
  const allLines = orders.flatMap((o) => o.lines);
  const productTimes = new Map<string, number>();
  for (const o of live) for (const l of o.lines) productTimes.set(l.productName, (productTimes.get(l.productName) ?? 0) + 1);
  const FRICTION: Array<{ key: string; label: string; types: string[] }> = [
    { key: 'estado', label: '¿Está listo? ¿Salió? ¿Lo recibió?', types: ['pregunta_estado'] },
    { key: 'stock', label: 'No hay, no tengo, se agotó', types: ['sin_stock'] },
    { key: 'aclaracion', label: '¿Cuál? ¿Cocido o ahumado? ¿Pieza o laminado?', types: ['aclaracion_producto'] },
    { key: 'reclamo', label: 'Reclamos y mermas', types: ['reclamo'] },
    { key: 'discontinuado', label: 'Vendido aunque ya no se hace', types: ['discontinuado'] },
    { key: 'plazo', label: 'Fuera de plazo o de horario', types: ['fuera_de_plazo'] },
    { key: 'equipo', label: 'Equipos e insumos', types: ['equipo'] },
  ];
  const insights = {
    period: PERIOD,
    messages: msgs.length,
    orders: orders.length,
    cancelled: orders.filter((o) => o.status === 'anulado').length,
    clients: [...clients.values()].filter((c) => !c.client.isInternalShop && !c.client.id.startsWith('wa-sin-cliente-')).length,
    newClients: raw.filter((o) => o.client?.isNew).length,
    sellers: [...sellerCount.entries()].sort((a, b) => b[1] - a[1]).map(([uid, n]) => ({ name: nameOfUid.get(uid) ?? uid, orders: n })),
    byHour,
    offHours: byHour.reduce((s, n, h) => s + (h < 8 || h >= 20 ? n : 0), 0),
    lines: allLines.length,
    linesWithIssue: issues.length,
    linesWithoutQty: allLines.filter((l) => (l.notes ?? '').includes('sin cantidad')).length,
    ordersWithoutDate: raw.filter((o) => !o.requestedDate).length,
    ordersWithoutClient: orders.filter((o) => o.clientId.startsWith('wa-sin-cliente-')).length,
    ordersWithBilling: orders.filter((o) => o.invoicingComplete).length,
    readyWithoutReference: msgs.filter((m) => /^listo\.?$/i.test(m.text)).length,
    storeLists: orders.filter((o) => o.kind === 'reposicion').length,
    consumptions,
    estimatedCLP: orders.filter((o) => o.status === 'entregado' && o.kind !== 'reposicion').reduce((s, o) => s + (o.totalCLP ?? 0), 0),
    committedCLP: orders.filter((o) => o.status === 'confirmado_parcial' && o.kind !== 'reposicion').reduce((s, o) => s + (o.totalCLP ?? 0), 0),
    kg: Math.round(live.flatMap((o) => o.lines).reduce((s, l) => s + (l.unit === 'kg' ? l.qty : 0), 0)),
    friction: FRICTION.map((f) => {
      const ev = events.filter((e) => f.types.includes(e.type));
      // Most telling first: longer quotes, one per person before repeating.
      const byLen = [...ev].sort((x, y) => y.quote.length - x.quote.length);
      const seenAuthor = new Set<string>();
      const picked = [...byLen.filter((e) => !seenAuthor.has(e.author) && seenAuthor.add(e.author)), ...byLen].filter((e, i, a) => a.indexOf(e) === i);
      return { key: f.key, label: f.label, count: ev.length, quotes: picked.slice(0, 6).map((e) => ({ author: personOf(e.author)?.displayName ?? e.author.replace(/~/g, '').trim(), ts: e.ts, quote: e.quote })) };
    }),
    upcoming: orders.filter((o) => o.status === 'confirmado_parcial').sort((a, b) => a.requestedDate.localeCompare(b.requestedDate)).slice(0, 15).map((o) => ({
      id: o.id, client: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name, date: o.requestedDate, seller: nameOfUid.get(o.createdBy) ?? '',
      summary: o.lines.slice(0, 3).map((l) => { const w = l.notes?.match(/≈ ([\d.,]+) kg/)?.[1]; return w ? `${w} kg ${l.productName}` : `${l.qty}${l.unit === 'kg' ? ' kg' : ''} ${l.productName}`; }).join(', ') + (o.lines.length > 3 ? ` y ${o.lines.length - 3} más` : ''),
    })),
    topClients: [...clients.values()].filter((c) => !c.client.isInternalShop && !c.client.id.startsWith('wa-sin-cliente-')).sort((a, b) => b.orders - a.orders).slice(0, 10).map((c) => ({ name: c.client.fantasyName ?? c.client.name, orders: c.orders })),
    topProducts: [...productTimes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, times]) => ({ name, times })),
    importedAt: Date.now(),
  };

  // ---------- resumen ----------
  console.log(`${apply ? 'Importando' : 'Simulación'} → ${emulated ? 'emuladores' : 'PROYECTO REAL'}`);
  console.log(`  pedidos: ${orders.length} (abiertos ${orders.filter((o) => o.status === 'confirmado_parcial').length}, cerrados ${orders.filter((o) => o.status === 'entregado').length}, anulados ${insights.cancelled})`);
  console.log(`  clientes: ${clients.size} · productos nuevos: ${newProducts.length} · personas: ${new Set(orders.map((o) => o.createdBy)).size}`);
  console.log(`  valorizado: $${insights.estimatedCLP.toLocaleString('es-CL')} · líneas con problema: ${issues.length}/${allLines.length} · mensajes: ${insights.messages}`);
  if (unmapped.length) console.log(`  sin mapear (${unmapped.length}):\n    ` + unmapped.slice(0, 25).join('\n    '));
  if (!apply) return;

  // ---------- escritura ----------
  // Re-runs must respect people already invited: a merged placeholder's
  // orders and portfolio go to the real uid, not back to wa-*.
  const mergedTo = new Map<string, string>();
  for (const p of Object.values(PEOPLE)) {
    const into = (await db.doc(`users/${p.uid}`).get()).data()?.mergedInto as string | undefined;
    if (into && into !== p.uid) mergedTo.set(p.uid, into);
  }
  const real = (uid?: string) => (uid ? mergedTo.get(uid) ?? uid : uid);
  for (const o of orders) { o.createdBy = real(o.createdBy)!; }
  for (const acc of clients.values()) { acc.client.ownerUid = real(acc.client.ownerUid); acc.client.createdBy = real(acc.client.createdBy); }
  if (mergedTo.size) console.log(`  respetando ${mergedTo.size} vendedores ya fusionados`);
  const prev = await db.collection('orders').where('source', '==', 'whatsapp').get();
  await commit(db, prev.docs.map((d) => ({ ref: d.ref, del: true })));
  const ops: Array<{ ref: DocumentReference; data?: object; merge?: boolean; del?: boolean }> = [];
  for (const p of newProducts) ops.push({ ref: db.doc(`products/${p.id}`), data: p });
  for (const p of patchedFormats) ops.push({ ref: db.doc(`products/${p.id}`), data: { formats: p.formats }, merge: true });
  for (const id of DISCONTINUED) if (catalog.has(id)) ops.push({ ref: db.doc(`products/${id}`), data: { discontinued: true }, merge: true });
  for (const id of UNTIL_SOLD_OUT) if (catalog.has(id)) ops.push({ ref: db.doc(`products/${id}`), data: { aliases: [...(catalog.get(id)!.aliases ?? []), 'hasta agotar stock'] }, merge: true });
  const usedUids = new Set([...orders.map((o) => o.createdBy), ...[...clients.values()].map((c) => c.client.ownerUid).filter(Boolean)]);
  for (const p of Object.values(PEOPLE)) {
    if (!usedUids.has(p.uid)) continue;
    const snap = await db.doc(`users/${p.uid}`).get();
    if (snap.exists && snap.data()?.mergedInto) continue;
    ops.push({ ref: db.doc(`users/${p.uid}`), data: { uid: p.uid, displayName: p.displayName, role: p.role, email: '', active: true, placeholder: true, createdAt: Date.now(), createdBy: 'import-whatsapp' } });
  }
  // Autor de los estados inferidos (aparece en el historial de cada pedido).
  ops.push({ ref: db.doc('users/wa-sistema'), data: { uid: 'wa-sistema', displayName: 'Historial WhatsApp', role: 'consultor', email: '', active: false, placeholder: true, mergedInto: 'wa-sistema', createdAt: Date.now(), createdBy: 'import-whatsapp' } });
  for (const acc of clients.values()) ops.push({ ref: db.doc(`clients/${acc.client.id}`), data: clean(acc.client), merge: true });
  for (const o of orders) ops.push({ ref: db.doc(`orders/${o.id}`), data: o });
  ops.push({ ref: db.doc('insights/whatsapp'), data: insights });
  await commit(db, ops);

  // Historial de Ciro y Luis: si ya entraron se fusiona ahora; si no, al entrar.
  const auth = getAuth();
  for (const [email, legacy] of Object.entries(INVITE_LEGACY)) {
    const inv = db.doc(`invites/${email}`);
    if ((await inv.get()).exists) { await inv.set({ legacyUid: legacy }, { merge: true }); console.log(`  ${email}: hereda ${legacy} al entrar`); continue; }
    try {
      const uid = (await auth.getUserByEmail(email)).uid;
      for (const [col, field] of [['orders', 'createdBy'], ['clients', 'ownerUid']] as const) {
        const s = await db.collection(col).where(field, '==', legacy).get();
        await commit(db, s.docs.map((d) => ({ ref: d.ref, data: { [field]: uid }, merge: true })));
      }
      await db.doc(`users/${legacy}`).set({ active: false, mergedInto: uid }, { merge: true });
      console.log(`  ${email}: historial fusionado en su cuenta`);
    } catch { /* sin cuenta ni invitación */ }
  }
  console.log('✅ Listo.');
}

async function commit(db: FirebaseFirestore.Firestore, ops: Array<{ ref: DocumentReference; data?: object; merge?: boolean; del?: boolean }>) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const op of ops.slice(i, i + 400)) {
      if (op.del) b.delete(op.ref); else b.set(op.ref, op.data!, { merge: !!op.merge });
    }
    await b.commit();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
