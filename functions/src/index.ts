import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Milestone 10 will replace this stub with the real Anthropic call + fallback.
// Kept here so the callable name is stable and the client can be wired ahead of time.
export const parseOrder = onCall({ region: 'us-central1' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  return { fallback: true, lines: [] };
});

export { bsaleProxy } from './bsaleProxy';
