import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'comandas-charcuteria-demo',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
};
export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');
if (useEmulators && typeof window !== 'undefined' && !globalThis.__emulatorsWired) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    globalThis.__emulatorsWired = true;
}
