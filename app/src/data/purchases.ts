import { useEffect, useState } from 'react';
import { addDoc, arrayUnion, collection, doc, getDoc, limit, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { forStorage } from '@/lib/docFiles';
import { describeFirestoreError } from '@/lib/errors';
import { lotsFrom, normText, type Purchase, type PurchaseDocument, type ReceivedBox, type Supplier, type Supply, type SupplyKind, type SupplyLot, type SupplyUnit } from '@/domain/purchases';

// Compras e insumos (ADR-0017). Solo super administración mientras dure el
// prototipo (firestore.rules: canReceivePurchases).

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
  await runTransaction(db, async (tx) => {
    const [existing, supplier] = await Promise.all([tx.get(purchaseRef), tx.get(supplierRef)]);
    if (existing.exists()) throw new DuplicatePurchase(existing.data() as Purchase);
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
