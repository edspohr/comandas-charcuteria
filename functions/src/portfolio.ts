import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from './common';
import { requireRole } from './bsale/config';

export const adminAssignClientOwner = onCall({ region: REGION }, async (req) => {
  const { uid } = requireRole(req, ['superAdmin'], 'reasignar carteras');
  const { clientId, ownerUid } = req.data ?? {};
  if (typeof clientId !== 'string' || !clientId || clientId.includes('/') || typeof ownerUid !== 'string' || ownerUid.includes('/')) {
    throw new HttpsError('invalid-argument', 'Cliente o vendedor no válido.');
  }
  const db = getFirestore();
  await db.runTransaction(async tx => {
    const ref = db.doc(`clients/${clientId}`);
    const client = await tx.get(ref);
    if (!client.exists || client.get('canonicalClientId')) throw new HttpsError('not-found', 'Cliente no disponible.');
    if (ownerUid) {
      const owner = await tx.get(db.doc(`users/${ownerUid}`));
      if (!owner.exists || owner.get('active') === false || owner.get('placeholder') || owner.get('mergedInto')) {
        throw new HttpsError('failed-precondition', 'Seleccione una cuenta habilitada.');
      }
    }
    const at = Date.now();
    tx.update(ref, { ownerUid: ownerUid || null, ownerAssignmentSource: 'manual', ownerAssignedAt: at, ownerAssignedBy: uid, ownerAssignmentEvidence: null });
    tx.set(db.collection('clientOwnerLog').doc(), { clientId, previousOwnerUid: client.get('ownerUid') ?? null, ownerUid: ownerUid || null, at, by: uid });
  });
  return { ok: true };
});
