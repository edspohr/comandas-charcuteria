// Sube el informe de oportunidades (tools/oportunidades/output/oportunidades_resumen.csv)
// a opportunityCandidates/*. Super administración elige después, en
// Oportunidades → Del informe, cuáles pasan a ser oportunidades y de quién.
// Idempotente: actualiza las filas pendientes y no toca las ya cargadas o
// descartadas.
//
//   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/import-oportunidades.ts <resumen.csv>                                  # simulación
//   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/import-oportunidades.ts <resumen.csv> --confirm comandas-charcuteria   # aplica
//   (con FIRESTORE_EMULATOR_HOST apunta a los emuladores)

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'comandas-charcuteria';
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a !== PROJECT);
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const apply = emulator || (args.includes('--confirm') && args[args.indexOf('--confirm') + 1] === PROJECT);
if (!file) { console.error('Uso: npx tsx scripts/import-oportunidades.ts <oportunidades_resumen.csv> [--confirm comandas-charcuteria]'); process.exit(1); }
initializeApp({ projectId: emulator ? 'comandas-charcuteria-demo' : PROJECT });
const db = getFirestore();

const normRut = (r: string) => r.replace(/[^0-9kK]/g, '').toUpperCase();
const num = (x: string | undefined) => { const n = Number((x ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };

// CSV con ';', BOM y comillas dobles (la propuesta puede traer ';' o saltos).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

async function main() {
  const rows = parseCsv(readFileSync(file!, 'utf8'));
  const clients = await db.collection('clients').get();
  const byRut = new Map<string, string>();
  clients.forEach((d) => { const rut = d.get('rut') as string | undefined; if (rut) byRut.set(normRut(rut), d.id); });
  const existing = new Map((await db.collection('opportunityCandidates').get()).docs.map((d) => [d.id, d.get('status') as string]));

  let created = 0, updated = 0, kept = 0, noClient = 0;
  const writes: Array<[string, Record<string, unknown>]> = [];
  for (const r of rows) {
    if (!r.rut) continue;
    const id = `inf-${normRut(r.rut)}`;
    const clientId = byRut.get(normRut(r.rut));
    if (!clientId) noClient++;
    const status = existing.get(id);
    if (status && status !== 'pendiente') { kept++; continue; }
    const doc = Object.fromEntries(Object.entries({
      id, rank: num(r.ranking) ?? 9999, score: num(r.score) ?? 0, rut: r.rut,
      razonSocial: r.razon_social, fantasyName: r.nombre_fantasia || r.razon_social, comuna: r.comuna || undefined,
      ventas12mCLP: num(r.venta_12m_neta_clp),
      productosSugeridos: (r.productos_sugeridos ?? '').split('|').map((p) => p.trim()).filter(Boolean),
      propuesta: r.propuesta || undefined, vendedorActual: r.vendedor_asignado || r.vendedor_actual || undefined,
      clientId, status: 'pendiente', importedAt: Date.now(),
    }).filter(([, v]) => v !== undefined));
    writes.push([id, doc]);
    if (status) updated++; else created++;
  }
  console.log(`${rows.length} filas · ${created} nuevas · ${updated} actualizadas · ${kept} ya cargadas o descartadas (sin cambio) · ${noClient} sin cliente en Comandas (no se podrán cargar)`);
  if (!apply) { console.log('Simulación: nada escrito. Agregue --confirm comandas-charcuteria para aplicar.'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [id, doc] of writes.slice(i, i + 400)) batch.set(db.doc(`opportunityCandidates/${id}`), doc, { merge: true });
    await batch.commit();
  }
  console.log('Listo.');
}

main().catch((e) => { console.error(e); process.exit(1); });
