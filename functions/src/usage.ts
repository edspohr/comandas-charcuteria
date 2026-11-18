import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from './common';

// Server time and authenticated uid only; no client-supplied usage data.
export const recordAppUsage = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const db = getFirestore();
  const userRef = db.doc(`users/${req.auth.uid}`);
  const ref = db.doc(`userUsage/${req.auth.uid}`);
  await db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists || user.data()?.active === false || user.data()?.placeholder || user.data()?.mergedInto) {
      throw new HttpsError('permission-denied', 'Usuario sin acceso.');
    }
    const snap = await tx.get(ref);
    const now = Date.now();
    const previous = snap.data();
    if (previous && now - previous.lastSeenAt < 5 * 60_000) return;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const days = [...new Set<string>([...(previous?.days ?? []), day])].sort().slice(-30);
    tx.set(ref, { firstSeenAt: previous?.firstSeenAt ?? now, lastSeenAt: now, days });
  });
  return { ok: true };
});
