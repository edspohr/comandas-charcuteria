import { useEffect, useState } from 'react';
import { addDoc, arrayUnion, collection, doc, getDoc, limit, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { forStorage } from '@/lib/docFiles';
import { describeFirestoreError } from '@/lib/errors';
import { applyReception, isOpenOrder, lotsFrom, normText, type Purchase, type PurchaseOrder, type PurchaseOrderItem, type PurchaseDocument, type ReceivedBox, type Supplier, type Supply, type SupplyKind, type SupplyLot, type SupplyUnit } from '@/domain/purchases';

// Compras e insumos (ADR-0017). Administración crea las compras por recibir;
// producción, despacho y superAdmin reciben (firestore.rules).

function useCollection<T>(path: string, order?: [string, 'asc' | 'desc'], max?: number): { items: T[]; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ items: T[]; loading: boolean; error: string | null }>({ items: [], loading: true, error: null });
  useEffect(() => {
    const parts = [...(order ? [orderBy(order[0], order[1])] : []), ...(max ? [limit(max)] : [])];
    return onSnapshot(query(collection(db, path), ...parts),
      (s) => setState({ items: s.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: null }),
      (e) => setState({ items: [], loading: false, error: describeFirestoreError(e) }));
  }, [path, order?.[0], order?.[1], max]);
  return state;
}

export const useSupplies = () => {
  const s = useCollection<Supply>('supplies');
  return { ...s, items: [...s.items].sort((a, b) => a.name.localeCompare(b.name, 'es')) };
};
export const useSuppliers = () => useCollection<Supplier>('suppliers');
export const usePurchases = (max = 100) => useCollection<Purchase>('purchases', ['receivedAt', 'desc'], max);
export const usePurchaseOrders = (max = 200) => useCollection<PurchaseOrder>('purchaseOrders', ['createdAt', 'desc'], max);
export const useSupplyLots = () => useCollection<SupplyLot>('supplyLots', ['receivedAt', 'desc'], 2000);
export const useScanTests = (max = 50) => useCollection<ScanTest & { id: string }>('scanTests', ['at', 'desc'], max);

export async function purchaseExists(id: string): Promise<Purchase | null> {
  const s = await getDoc(doc(db, 'purchases', id));
  return s.exists() ? (s.data() as Purchase) : null;
}

export async function createSupply(input: { name: string; kind: SupplyKind; unit: SupplyUnit; code?: string; alias?: string }, by: string): Promise<Supply> {
  const ref = doc(collection(db, 'supplies'));
  const now = Date.now();
  const s: Supply = {
    id: ref.id, name: input.name.trim(), kind: input.kind, unit: input.unit,
    codes: input.code ? [input.code] : [], aliases: input.alias ? [normText(input.alias)] : [],
    createdAt: now, createdBy: by, updatedAt: now,
  };
  await setDoc(ref, s);
  return s;
}

export async function addSupplyCode(supplyId: string, code: string) {
  await updateDoc(doc(db, 'supplies', supplyId), { codes: arrayUnion(code), updatedAt: Date.now() });
}

// Sube la foto o el PDF del documento a purchases/{id}/. Cada archivo lleva
// la hora en el nombre: nunca reemplaza otro (las reglas no lo permiten).
export async function uploadPurchaseDocuments(purchaseId: string, files: Array<{ blob: Blob; name: string }>, by: string): Promise<PurchaseDocument[]> {
  const out: PurchaseDocument[] = [];
  for (const [i, f] of files.entries()) {
    const { blob, contentType, ext } = await forStorage(f.blob);
    const base = f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'documento';
    const path = `purchases/${purchaseId}/${Date.now()}-${i + 1}-${base}.${ext}`;
    await uploadBytes(storageRef(storage, path), blob, { contentType });
    out.push({ path, name: f.name || `documento.${ext}`, contentType, size: blob.size, uploadedAt: Date.now(), uploadedBy: by });
  }
  return out;
}

export async function addPurchaseDocuments(purchaseId: string, files: Array<{ blob: Blob; name: string }>, by: string) {
  const docs = await uploadPurchaseDocuments(purchaseId, files, by);
  await updateDoc(doc(db, 'purchases', purchaseId), { documents: arrayUnion(...docs) });
}

export const documentUrl = (path: string) => getDownloadURL(storageRef(storage, path));

export class DuplicatePurchase extends Error {
  constructor(public existing: Purchase) { super(`Esta compra ya está registrada (${existing.receivedByName}, ${new Date(existing.receivedAt).toLocaleDateString('es-CL')}).`); }
}

// Crea la compra, el proveedor, los alias de las líneas y los lotes, todo o
// nada. Falla si la compra (RUT-tipo-folio) ya existe.
export async function savePurchase(p: Purchase, boxes: ReceivedBox[]): Promise<void> {
  const purchaseRef = doc(db, 'purchases', p.id);
  const supplierRef = doc(db, 'suppliers', p.supplierRut.replace(/[^0-9kK]/g, '').toUpperCase() || '_sin_rut');
  const orderRef = p.orderId ? doc(db, 'purchaseOrders', p.orderId) : null;
  await runTransaction(db, async (tx) => {
    const [existing, supplier, orderSnap] = await Promise.all([tx.get(purchaseRef), tx.get(supplierRef), orderRef ? tx.get(orderRef) : Promise.resolve(null)]);
    if (existing.exists()) throw new DuplicatePurchase(existing.data() as Purchase);
    // Recepción contra una compra: suma lo recibido y la deja parcial o recibida.
    if (orderRef && orderSnap) {
      const po = orderSnap.data() as PurchaseOrder | undefined;
      if (!po) throw new Error('La compra ya no existe.');
      if (!isOpenOrder(po)) throw new Error(`La compra ${po.number} ya está ${po.status === 'anulada' ? 'anulada' : 'cerrada'}.`);
      const next = p.againstGuide ? { received: po.received ?? {}, status: po.status === 'por_recibir' ? 'parcial' as const : po.status } : applyReception(po, p.summary);
      tx.update(orderRef, { received: next.received, status: next.status, receptions: arrayUnion(p.id), updatedAt: p.receivedAt });
    }
    // Sin RUT (compra sin documento) no se crea proveedor.
    if (supplierRef.id !== '_sin_rut' && !supplier.exists()) {
      tx.set(supplierRef, { id: supplierRef.id, rut: p.supplierRut, name: p.supplierName, createdAt: p.receivedAt, createdBy: p.receivedBy } satisfies Supplier);
    }
    tx.set(purchaseRef, strip(p as unknown as Record<string, unknown>));
    const aliases = new Map<string, string[]>();
    for (const l of p.lines) if (l.supplyId && normText(l.description)) aliases.set(l.supplyId, [...(aliases.get(l.supplyId) ?? []), normText(l.description)]);
    for (const [id, list] of aliases) tx.update(doc(db, 'supplies', id), { aliases: arrayUnion(...list), updatedAt: p.receivedAt });
    if (p.againstGuide) return;
    for (const l of lotsFrom(boxes, p.summary)) {
      const ref = doc(collection(db, 'supplyLots'));
      tx.set(ref, strip({ ...l, id: ref.id, origin: 'compra', purchaseId: p.id, supplierName: p.supplierName, receivedAt: p.receivedAt, receivedBy: p.receivedBy } as Record<string, unknown>));
    }
  });
}

// ---------- Compras por recibir ----------

export interface NewPurchaseOrder { supplierRut?: string; supplierName: string; expectedDate: string; items: PurchaseOrderItem[]; note?: string }

function validOrder(o: NewPurchaseOrder) {
  if (!o.supplierName.trim()) throw new Error('Indique el proveedor.');
  if (!o.expectedDate) throw new Error('Indique la fecha en que llega.');
  if (!o.items.length || o.items.some((i) => !(i.qty > 0))) throw new Error('Agregue al menos un insumo con su cantidad.');
}

export async function createPurchaseOrder(o: NewPurchaseOrder, me: { uid: string; name: string }): Promise<PurchaseOrder> {
  validOrder(o);
  const ref = doc(collection(db, 'purchaseOrders'));
  const now = Date.now();
  const d = new Date(now);
  const number = `OC-${d.getFullYear() % 100}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${ref.id.slice(0, 4).toUpperCase()}`;
  const po: PurchaseOrder = {
    id: ref.id, number, supplierRut: o.supplierRut?.trim() || undefined, supplierName: o.supplierName.trim(), expectedDate: o.expectedDate,
    items: o.items, note: o.note?.trim() || undefined, status: 'por_recibir', received: {}, receptions: [],
    createdBy: me.uid, createdByName: me.name, createdAt: now, updatedAt: now,
  };
  await setDoc(ref, strip(po));
  return po;
}

// Antes de la primera recepción se puede corregir todo; después, solo
// cantidades, fecha y nota (lo recibido queda).
export async function updatePurchaseOrder(po: PurchaseOrder, o: NewPurchaseOrder) {
  validOrder(o);
  await updateDoc(doc(db, 'purchaseOrders', po.id), strip({
    supplierRut: o.supplierRut?.trim() || null, supplierName: o.supplierName.trim(), expectedDate: o.expectedDate,
    items: o.items, note: o.note?.trim() || null, updatedAt: Date.now(),
  }) as Record<string, unknown>);
}

export async function closePurchaseOrder(po: PurchaseOrder, by: string, note: string, cancel = false) {
  if (!note.trim()) throw new Error('Indique el motivo.');
  await updateDoc(doc(db, 'purchaseOrders', po.id), { status: cancel ? 'anulada' : 'cerrada', closedBy: by, closedAt: Date.now(), closedNote: note.trim().slice(0, 300), updatedAt: Date.now() });
}

// Laboratorio de escaneo: cada lectura queda para ajustar el intérprete con
// etiquetas reales (scripts/export-scan-tests.ts).
export interface ScanTest {
  at: number;
  by: string;
  format: string;
  text: string;
  symbology?: string;
  source: 'video' | 'foto' | 'archivo';
  parsed: Record<string, unknown>;
  note?: string;
  ua: string;
}
export async function saveScanTest(t: ScanTest) {
  await addDoc(collection(db, 'scanTests'), strip(t as unknown as Record<string, unknown>));
}

// Firestore no acepta undefined: se limpian también los objetos anidados.
function strip<T>(v: T): T {
  if (Array.isArray(v)) return v.map(strip) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = strip(x);
    return out as T;
  }
  return v;
}
