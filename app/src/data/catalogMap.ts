import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Product, ProductFormat } from '@/domain/types';

// Cruce variante Bsale ↔ producto/formato de la app. El diagnóstico deja
// sugerencias; administración las confirma acá. Solo las confirmadas mueven
// stock, documentos y escrituras (functions/src/bsale/sync.ts).

export type MapStatus = 'sugerido' | 'confirmado' | 'ignorado';

export interface CatalogMapEntry {
  variantId: string;
  productId?: string;
  formatId?: string;
  status: MapStatus;
  score?: number;
  bsaleLabel?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface BsaleVariantMirror {
  variantId: string;
  bsaleProductId: string;
  productName: string;
  description: string;
  label: string;
  code?: string;
  barCode?: string;
  productType?: string;
  active: boolean;
  stockControl: boolean;
  allowDecimal: boolean;
  priceCLP?: number;
  netPriceCLP?: number;
}

function useCollection<T>(path: string): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => onSnapshot(collection(db, path), (s) => { const l: T[] = []; s.forEach((d) => l.push(d.data() as T)); setItems(l); }, () => setItems([])), [path]);
  return items;
}

export const useCatalogMap = () => useCollection<CatalogMapEntry>('catalogMap');
export const useBsaleVariants = () => useCollection<BsaleVariantMirror>('bsale/catalog/variants');

export async function setMapping(variantId: string, patch: Partial<CatalogMapEntry>, by: string) {
  await setDoc(doc(db, 'catalogMap', variantId), { variantId, ...patch, updatedAt: Date.now(), updatedBy: by }, { merge: true });
}

export async function confirmMany(entries: CatalogMapEntry[], by: string) {
  for (let i = 0; i < entries.length; i += 400) {
    const b = writeBatch(db);
    for (const e of entries.slice(i, i + 400)) b.set(doc(db, 'catalogMap', e.variantId), { status: 'confirmado', updatedAt: Date.now(), updatedBy: by }, { merge: true });
    await b.commit();
  }
}

export async function ignoreMany(variantIds: string[], by: string) {
  for (let i = 0; i < variantIds.length; i += 400) {
    const b = writeBatch(db);
    for (const id of variantIds.slice(i, i + 400)) b.set(doc(db, 'catalogMap', id), { variantId: id, status: 'ignorado', updatedAt: Date.now(), updatedBy: by }, { merge: true });
    await b.commit();
  }
}

const slug = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const title = (s: string) => s.toLocaleLowerCase('es').replace(/(^|\s)\S/g, (m) => m.toLocaleUpperCase('es'));

// Formato de la app a partir de la descripción de la variante Bsale.
export function formatFromVariant(v: BsaleVariantMirror): ProductFormat {
  const d = `${v.description} ${v.productName}`.toLowerCase();
  const grams = Number(d.match(/(\d{2,4})\s?g(r|rs)?\b/)?.[1] ?? NaN);
  const price = v.priceCLP;
  if (/\b(kg|kilo|granel|laminad)/.test(d) && !/pieza|entero/.test(d)) {
    return { formatId: 'granel-kg', label: v.description ? title(v.description) : 'Granel (kg)', unit: 'kg', pricePerKgCLP: price };
  }
  if (/pieza|entero|entera/.test(d)) {
    return { formatId: 'pieza', label: v.description ? title(v.description) : 'Pieza', unit: 'unidad', pricePerKgCLP: price };
  }
  return {
    formatId: Number.isFinite(grams) ? `sachet-${grams}g` : `v-${v.variantId}`,
    label: v.description ? title(v.description) : 'Unidad',
    unit: 'unidad',
    grams: Number.isFinite(grams) ? grams : undefined,
    priceCLP: price,
  };
}

// Crea en la app un producto con todas las variantes de un producto Bsale y
// deja el cruce confirmado. Para lo que el diagnóstico no pudo emparejar.
export async function createProductFromBsale(variants: BsaleVariantMirror[], by: string): Promise<string> {
  if (variants.length === 0) throw new Error('Sin variantes');
  const first = variants[0];
  const id = `${slug(first.productName) || 'producto'}-${first.bsaleProductId}`;
  const formats: ProductFormat[] = [];
  const used = new Set<string>();
  for (const v of variants) {
    const f = formatFromVariant(v);
    if (used.has(f.formatId)) f.formatId = `${f.formatId}-${v.variantId}`;
    used.add(f.formatId);
    formats.push(Object.fromEntries(Object.entries(f).filter(([, x]) => x !== undefined)) as ProductFormat);
  }
  const product: Product = {
    id,
    name: title(first.productName),
    category: (first.productType ?? 'otros').toLowerCase(),
    active: true,
    discontinued: false,
    formats,
  };
  const b = writeBatch(db);
  b.set(doc(db, 'products', id), product);
  variants.forEach((v, i) => b.set(doc(db, 'catalogMap', v.variantId), { variantId: v.variantId, productId: id, formatId: formats[i].formatId, status: 'confirmado', bsaleLabel: v.label, updatedAt: Date.now(), updatedBy: by }, { merge: true }));
  await b.commit();
  return id;
}

// Precios de la lista elegida en Bsale → formatos de la app (solo cruces
// confirmados). Devuelve cuántos formatos cambiaron.
export async function pullPricesFromBsale(products: Product[], map: CatalogMapEntry[], variants: BsaleVariantMirror[]): Promise<number> {
  const priceByKey = new Map<string, number>();
  const vById = new Map(variants.map((v) => [v.variantId, v]));
  for (const m of map) {
    if (m.status !== 'confirmado' || !m.productId || !m.formatId) continue;
    const p = vById.get(m.variantId)?.priceCLP;
    if (p != null && !priceByKey.has(`${m.productId}__${m.formatId}`)) priceByKey.set(`${m.productId}__${m.formatId}`, p);
  }
  let changed = 0;
  const b = writeBatch(db);
  for (const p of products) {
    let touched = false;
    const formats = p.formats.map((f) => {
      const price = priceByKey.get(`${p.id}__${f.formatId}`);
      if (price == null) return f;
      const byKg = f.unit === 'kg' || f.formatId === 'pieza' || f.pricePerKgCLP != null;
      const current = byKg ? f.pricePerKgCLP : f.priceCLP;
      if (current === price) return f;
      touched = true; changed++;
      return byKg ? { ...f, pricePerKgCLP: price } : { ...f, priceCLP: price };
    });
    if (touched) b.update(doc(db, 'products', p.id), { formats });
  }
  if (changed) await b.commit();
  return changed;
}
