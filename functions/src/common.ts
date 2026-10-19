import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

export const REGION = 'us-central1';

// Copia de app/src/domain/types.ts → Role. functions no puede importar desde
// app/ (rootDir distinto); si se agrega un perfil, agregarlo en ambos lados y
// en firestore.rules.
export const ROLES = [
  'vendedor', 'tienda', 'despacho', 'reparto', 'produccion', 'admin', 'superAdmin', 'consultor',
] as const;
export type Role = typeof ROLES[number];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}
