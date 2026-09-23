import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'comandas-charcuteria-demo',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
};

export const app = initializeApp(config);

// App Check is mandatory for Firebase AI Logic (Gemini): the project refuses
// AI calls until enforcement is on and every request carries an App Check
// token. We use reCAPTCHA *Enterprise* (score key, no secret to paste anywhere);
// `scripts/appcheck-setup.mjs` creates the key, registers it and turns on
// enforcement for firebaseml.googleapis.com (= Firebase AI Logic).
// Without a key we simply don't initialize it (Firestore/Auth keep working;
// only the AI features fall back to the local parser).
//   - VITE_RECAPTCHA_SITE_KEY: reCAPTCHA Enterprise key id (public, ships in
//     the bundle). `localhost` is an allowed domain, so `vite` works as-is.
//   - VITE_APPCHECK_DEBUG=true + VITE_APPCHECK_DEBUG_TOKEN: only for
//     environments where reCAPTCHA can't run (CI, emulators); the token must be
//     registered in App Check → Apps → Manage debug tokens.
export let appCheck: AppCheck | null = null;
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (typeof window !== 'undefined' && recaptchaKey && !useEmulators) {
  if (import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) || true;
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
// Real Firestore rejects undefined field values (createOrder sends optional
// notes / rawText / clientSnapshot.rut as undefined for some inputs).
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const functions = getFunctions(app, 'us-central1');

if (useEmulators && typeof window !== 'undefined' && !(globalThis as any).__emulatorsWired) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  (globalThis as any).__emulatorsWired = true;
}
