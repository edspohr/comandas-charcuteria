// Baja las lecturas del Laboratorio de Compras (scanTests/*) a un JSON, para
// ajustar el intérprete de etiquetas (app/src/domain/gs1.ts) con casos reales.
//
//   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/export-scan-tests.ts [salida.json]
//   (con FIRESTORE_EMULATOR_HOST apunta a los emuladores)

import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const out = process.argv[2] ?? 'private/scan-tests.json';
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp({ projectId: emulator ? 'comandas-charcuteria-demo' : 'comandas-charcuteria' });

const snap = await getFirestore().collection('scanTests').orderBy('at', 'asc').get();
const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), text: String(d.get('text')).replace(/\u001d/g, '<GS>') }));
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`${rows.length} lecturas → ${out}`);
