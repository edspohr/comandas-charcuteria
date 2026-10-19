import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { REGION } from './common';
import { BSALE_TOKEN, BsaleApi, BsaleHttpError } from './bsale/api';
import { requireRole } from './bsale/config';

// Ventana de solo lectura a la API de Bsale para el explorador del
// consultor y administración: GET a cualquier recurso de la allowlist, con
// el token en el servidor. Las escrituras van solo por las funciones
// específicas de bsale/index.ts (con bitácora y simulacro).

const ALLOWED_PATHS = /^\/v1\/(stocks|documents|clients|products|variants|offices|document_types|price_lists|product_types|users|shippings|shipping_types|payments|payment_types|returns|sellers|stocks\/receptions|stocks\/consumptions)(\.json|\/[\w/.-]+\.json)(\?.*)?$/;

export const bsaleProxy = onCall({ region: REGION, secrets: [BSALE_TOKEN] }, async (req) => {
  requireRole(req, ['superAdmin', 'admin', 'consultor'], 'consultar Bsale directamente');
  const path = String(req.data?.path ?? '');
  if (!ALLOWED_PATHS.test(path)) throw new HttpsError('permission-denied', `Ruta ${path} no está en la lista permitida.`);
  try {
    const data = await new BsaleApi(BSALE_TOKEN.value()).get(path);
    return { status: 200, data };
  } catch (e) {
    if (e instanceof BsaleHttpError) throw new HttpsError('unavailable', `Bsale respondió ${e.status}`, { status: e.status, body: e.body });
    throw e;
  }
});
