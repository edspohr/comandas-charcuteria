import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Role } from '../common';

// settings/bsale — configuración de la integración real. La edita un
// superAdmin desde la pantalla Bsale; las funciones la leen en cada corrida.
export interface BsaleSettings {
  // Interruptor general: sin esto ni el cron ni los webhooks hacen nada.
  enabled: boolean;
  // Escrituras hacia Bsale (recepciones, traslados, clientes). Con
  // `dryRun` se registran en bsale/writes/log sin enviarse.
  writesEnabled: boolean;
  dryRun: boolean;
  factoryOfficeId?: number;   // sucursal cuyo stock respalda los pedidos
  storeOfficeId?: number;     // tienda (recibe traslados, vende por mesón)
  priceListId?: number;       // lista de precios para valorizar pedidos
  // Clasificación manual de tipos de documento por id (si el código SII no basta).
  docTypeKinds?: Record<string, DocKind>;
  // Cómo registrar un traslado fábrica → tienda.
  transferMode?: 'consumo_recepcion' | 'guia';
  transferShippingTypeId?: number;
  transferDocumentTypeId?: number;
  documentsSyncedUntil?: number; // epoch s
  clientsSyncedAt?: number;      // epoch ms
}

export type DocKind = 'factura' | 'boleta' | 'guia' | 'nota_credito' | 'otro';

export const DEFAULT_SETTINGS: BsaleSettings = {
  enabled: false,
  writesEnabled: false,
  dryRun: true,
  transferMode: 'consumo_recepcion',
};

export async function loadSettings(): Promise<BsaleSettings> {
  const snap = await getFirestore().doc('settings/bsale').get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? (snap.data() as Partial<BsaleSettings>) : {}) };
}

export async function patchSettings(patch: Partial<BsaleSettings>) {
  await getFirestore().doc('settings/bsale').set(patch, { merge: true });
}

export function requireRole(req: CallableRequest, roles: Role[], what: string): { uid: string; role: Role } {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const role = req.auth.token.role as Role | undefined;
  if (!role || !roles.includes(role)) throw new HttpsError('permission-denied', `Su perfil no permite ${what}.`);
  return { uid: req.auth.uid, role };
}

export function requireEnabled(s: BsaleSettings) {
  if (!s.enabled) throw new HttpsError('failed-precondition', 'La integración con Bsale está apagada. Actívela en Bsale → Configuración.');
}

export function requireFactory(s: BsaleSettings): number {
  if (!s.factoryOfficeId) throw new HttpsError('failed-precondition', 'Falta elegir la sucursal de fábrica en Bsale → Configuración.');
  return s.factoryOfficeId;
}

export function docKindFor(s: BsaleSettings, docTypeId: string | number | undefined, codeSii?: string, name?: string): DocKind {
  const manual = docTypeId != null ? s.docTypeKinds?.[String(docTypeId)] : undefined;
  if (manual) return manual;
  const code = String(codeSii ?? '');
  if (code === '33' || code === '34') return 'factura';
  if (code === '39' || code === '41') return 'boleta';
  if (code === '52') return 'guia';
  if (code === '61') return 'nota_credito';
  const n = (name ?? '').toLowerCase();
  if (n.includes('factura')) return 'factura';
  if (n.includes('boleta')) return 'boleta';
  if (n.includes('gu')) return 'guia';
  if (n.includes('crédito') || n.includes('credito')) return 'nota_credito';
  return 'otro';
}

export const DOC_PREFIX: Record<DocKind, string> = { factura: 'FA', boleta: 'BO', guia: 'GD', nota_credito: 'NC', otro: 'DOC' };
