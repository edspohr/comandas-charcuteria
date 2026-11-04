// Archivos del borrador de una recepción (fotos y PDF del documento) en
// IndexedDB: localStorage no alcanza para imágenes. Así sobreviven a que la
// pantalla se apague o la app se recargue a mitad de la recepción.

const DB = 'comandas-files';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putFile(id: string, blob: Blob): Promise<void> {
  try { await tx('readwrite', (s) => s.put(blob, id)); } catch { /* sin IndexedDB: queda solo en memoria */ }
}
export async function getFile(id: string): Promise<Blob | undefined> {
  try { return await tx<Blob | undefined>('readonly', (s) => s.get(id)); } catch { return undefined; }
}
export async function deleteFile(id: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
}
