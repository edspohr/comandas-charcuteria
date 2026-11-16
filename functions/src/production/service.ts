import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { allocateIngredients, type Ingredient, type LotBalance, type ProducedLine, type ProductionBatch } from './model';

export const validId = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return id;
};
export async function startBatch(db: Firestore, id: string, process: string, inputs: Ingredient[], user: { uid: string; name: string }, note = '') {
  validId(id);
  if (!process.trim() || process.length > 120 || !Array.isArray(inputs)) throw new HttpsError('invalid-argument', 'Indique el proceso y sus insumos.');
  const ref = db.doc(`productionBatches/${id}`);
  return db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    if (previous.exists) {
      const batch = previous.data() as ProductionBatch;
      if (batch.by !== user.uid) throw new HttpsError('permission-denied', 'El identificador ya está en uso.');
      return batch;
    }
    if (!inputs.length || inputs.length > 40) throw new HttpsError('invalid-argument', 'Seleccione entre 1 y 40 insumos.');
    const units = new Map<string, 'kg' | 'unidad'>();
    const lots: LotBalance[] = [];
    for (const input of inputs) {
      if (!input || typeof input !== 'object') throw new HttpsError('invalid-argument', 'Insumo inválido.');
      validId(input.supplyId);
      const supply = await tx.get(db.doc(`supplies/${input.supplyId}`));
      if (!supply.exists || !['kg', 'unidad'].includes(supply.get('unit'))) throw new HttpsError('invalid-argument', 'Insumo inexistente.');
      units.set(input.supplyId, supply.get('unit'));
      const snap = await tx.get(db.collection('supplyLots').where('supplyId', '==', input.supplyId));
      lots.push(...snap.docs.map(d => ({ ...d.data(), id: d.id } as LotBalance)));
    }
    let consumed;
    try { consumed = allocateIngredients(inputs, lots, units, new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())); }
    catch (e) { throw new HttpsError('failed-precondition', (e as Error).message); }
    const batch: ProductionBatch = { id, process: process.trim(), status: 'en_proceso', at: Date.now(), by: user.uid, byName: user.name, note: note.slice(0, 500), inputs: consumed, inputKg: consumed.filter(c => c.unit === 'kg').reduce((s, c) => s + c.qty, 0), knownCostCLP: consumed.reduce((s, c) => s + (c.costCLP ?? 0), 0), costComplete: consumed.every(c => c.costCLP !== null) };
    for (const c of consumed) {
      const lot = lots.find(l => l.id === c.lotId)!;
      tx.update(db.doc(`supplyLots/${c.lotId}`), c.unit === 'kg' ? { consumedKg: (lot.consumedKg ?? 0) + c.qty } : { consumedUnits: (lot.consumedUnits ?? 0) + c.qty });
      tx.set(db.doc(`supplyMovements/${id}_${c.lotId}`), { ...c, batchId: id, by: user.uid, at: batch.at, type: 'consumo' });
    }
    tx.create(ref, batch);
    return batch;
  });
}
export async function cancelBatch(db: Firestore, id: string, uid: string) {
  const ref = db.doc(`productionBatches/${validId(id)}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Elaboración inexistente.');
    const b = snap.data() as ProductionBatch;
    if (b.status === 'anulada') return;
    if (b.status !== 'en_proceso') throw new HttpsError('failed-precondition', 'La elaboración ya terminó.');
    const lots = await Promise.all(b.inputs.map(c => tx.get(db.doc(`supplyLots/${c.lotId}`))));
    const at = Date.now();
    b.inputs.forEach((c, i) => {
      const field = c.unit === 'kg' ? 'consumedKg' : 'consumedUnits';
      const value = (lots[i].get(field) ?? 0) - c.qty;
      if (value < -0.001) throw new HttpsError('failed-precondition', 'El saldo del lote requiere revisión.');
      tx.update(lots[i].ref, { [field]: Math.max(0, value) });
      tx.create(db.doc(`supplyMovements/${id}_${c.lotId}_devolucion`), { ...c, batchId: id, by: uid, at, type: 'devolucion' });
    });
    tx.update(ref, { status: 'anulada', cancelledAt: at, cancelledBy: uid });
  });
}
export async function closeBatch(db: Firestore, id: string, raw: Array<{ productId: string; formatId: string; qty: number; outputKg: number }>, user: { uid: string; name: string }) {
  const ref = db.doc(`productionBatches/${validId(id)}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Elaboración inexistente.');
    const b = snap.data() as ProductionBatch;
    if (b.status === 'terminada') return b.productionEntryId!;
    if (b.status !== 'en_proceso') throw new HttpsError('failed-precondition', 'La elaboración está anulada.');
    if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new HttpsError('invalid-argument', 'Registre entre 1 y 40 productos obtenidos.');
    const outputs: ProducedLine[] = [];
    const seen = new Set<string>();
    for (const l of raw) {
      validId(l.productId); validId(l.formatId);
      const key = `${l.productId}__${l.formatId}`;
      if (seen.has(key) || !Number.isFinite(l.qty) || !Number.isFinite(l.outputKg) || l.qty <= 0 || l.outputKg <= 0 || l.qty > 1e6 || l.outputKg > 1e6) throw new HttpsError('invalid-argument', 'Revise cantidades y kilos obtenidos, sin repetir formatos.');
      seen.add(key);
      const p = await tx.get(db.doc(`products/${l.productId}`));
      const f = (p.get('formats') ?? []).find((f: { formatId: string }) => f.formatId === l.formatId);
      if (!p.exists || !p.get('active') || p.get('discontinued') || !f) throw new HttpsError('invalid-argument', 'Producto o formato no vigente.');
      if ((f.unit === 'unidad' && !Number.isInteger(l.qty)) || (f.unit === 'kg' && Math.abs(l.qty - l.outputKg) > 0.001) || (f.unit === 'g' && Math.abs(l.qty / 1000 - l.outputKg) > 0.001)) throw new HttpsError('invalid-argument', 'La cantidad y los kilos producidos no coinciden.');
      outputs.push({ productId: l.productId, formatId: l.formatId, qty: l.qty, outputKg: l.outputKg, productName: p.get('name'), formatLabel: f.label, unit: f.unit });
    }
    const at = Date.now();
    const entryId = `batch_${id}`;
    const outputKg = outputs.reduce((s, l) => s + l.outputKg, 0);
    tx.create(db.doc(`productionLog/${entryId}`), { id: entryId, at, by: user.uid, byName: user.name, lines: outputs, source: 'manual', note: b.process, batchId: id, bsaleStatus: 'por_cargar' });
    tx.update(ref, { status: 'terminada', outputs, outputKg, closedAt: at, closedBy: user.uid, productionEntryId: entryId });
    return entryId;
  });
}

export async function sendBatchProduction(db: Firestore, entryId: string, uid: string, send: (entry: Record<string, any>) => Promise<{ logId: string }>, sync: () => Promise<unknown>) {
  const ref = db.doc(`productionLog/${validId(entryId)}`);
  const entry = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get('batchId')) throw new HttpsError('not-found', 'Elaboración no encontrada.');
    const batch = await tx.get(db.doc(`productionBatches/${validId(snap.get('batchId'))}`));
    if (!batch.exists || batch.get('status') !== 'terminada' || batch.get('productionEntryId') !== entryId) throw new HttpsError('failed-precondition', 'La carga no corresponde a una elaboración terminada.');
    if (snap.get('bsaleStatus') !== 'por_cargar' || snap.get('bsaleAttemptAt')) return null;
    tx.update(ref, { bsaleStatus: 'enviando', bsaleAttemptAt: Date.now(), bsaleAttemptBy: uid });
    return snap.data()!;
  });
  if (!entry) return { status: 'consultar', message: 'Esta elaboración ya fue enviada o tiene un envío en revisión. No se volvió a cargar.' };
  try {
    const result = await send(entry);
    await ref.update({ bsaleStatus: 'ok', bsaleLogId: result.logId });
  } catch (e) {
    await ref.update({ bsaleStatus: 'revisar', bsaleError: (e as Error).message });
    return { status: 'revisar', message: 'La elaboración quedó guardada. Revise Bsale antes de cargarla manualmente: el envío no se repetirá automáticamente.' };
  }
  try { await sync(); }
  catch { return { status: 'ok', message: 'Producción recibida en Bsale. Falta actualizar el stock con Sincronizar.' }; }
  return { status: 'ok', message: 'Producción recibida en Bsale y stock actualizado.' };
}
