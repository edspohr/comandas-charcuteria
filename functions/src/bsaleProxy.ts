import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

// Proxy autenticado hacia la API real de Bsale. Sin desplegar todavía: la
// integración real queda para después de la demo (ver README → "Activar Bsale
// real"). Se deja el esqueleto para que RealBsaleClient pueda apuntarle apenas
// se cargue el token.
//
// Motivo del proxy: el token de Bsale no puede vivir en el bundle del browser.
// Este callable recibe {method, path, body}, agrega el header `access_token`
// desde Secret Manager y forwardea a https://api.bsale.io.

const BSALE_TOKEN = defineSecret('BSALE_ACCESS_TOKEN');

const ALLOWED_PATHS = /^\/v1\/(stocks|documents|clients|receptions)(\.json|\/.+\.json)$/;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT']);
const BASE_URL = 'https://api.bsale.io';

interface Payload { method: string; path: string; body?: unknown; }

export const bsaleProxy = onCall({ region: 'us-central1', secrets: [BSALE_TOKEN] }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  // La app llama a este proxy sólo desde despacho/admin/producción: la
  // autorización fina la aplican las rules del lado del stock/orders. Acá
  // limitamos a un allowlist de rutas para que un rol comprometido no llegue
  // a endpoints de Bsale que la app no usa.
  const { method, path, body } = req.data as Payload;
  if (typeof method !== 'string' || typeof path !== 'string') throw new HttpsError('invalid-argument', 'method y path son obligatorios.');
  const m = method.toUpperCase();
  if (!ALLOWED_METHODS.has(m)) throw new HttpsError('invalid-argument', `Método ${m} no permitido.`);
  if (!ALLOWED_PATHS.test(path)) throw new HttpsError('permission-denied', `Ruta ${path} no está en el allowlist.`);

  const token = BSALE_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'BSALE_ACCESS_TOKEN no configurado.');

  const res = await fetch(`${BASE_URL}${path}`, {
    method: m,
    headers: { 'access_token': token, 'content-type': 'application/json' },
    body: body != null && m !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new HttpsError('unavailable', `Bsale respondió ${res.status}`, { status: res.status, body: data });
  return { status: res.status, data };
});
