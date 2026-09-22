import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'comandas-charcuteria-demo',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
};

export const app = initializeApp(config);
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
