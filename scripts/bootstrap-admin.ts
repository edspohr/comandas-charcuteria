// Primeros accesos del proyecto real: deja invitaciones (o actualiza el
// perfil si la persona ya entró). Después de esto, un superAdmin agrega al
// resto desde la pantalla Usuarios.
//
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   npx tsx scripts/bootstrap-admin.ts ciro@lacharcuteriartesanal.cl "Ciro" superAdmin [más tripletas…]
//
// Con FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST seteados apunta a
// los emuladores.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const ROLES = ['vendedor', 'tienda', 'despacho', 'reparto', 'produccion', 'admin', 'superAdmin', 'consultor'];

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 3 !== 0) {
  console.error('Uso: bootstrap-admin.ts <correo> <nombre> <perfil> [<correo> <nombre> <perfil> …]');
  console.error(`Perfiles: ${ROLES.join(', ')}`);
  process.exit(1);
}

const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulated && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Falta GOOGLE_APPLICATION_CREDENTIALS (cuenta de servicio del proyecto real).');
  process.exit(1);
}
initializeApp({ projectId: emulated ? 'comandas-charcuteria-demo' : 'comandas-charcuteria' });
const db = getFirestore();
const auth = getAuth();

async function main() {
  for (let i = 0; i < args.length; i += 3) {
    const email = args[i].trim().toLowerCase();
    const displayName = args[i + 1].trim();
    const role = args[i + 2];
    if (!ROLES.includes(role)) { console.error(`✗ ${email}: perfil "${role}" no existe`); continue; }

    let uid: string | null = null;
    try { uid = (await auth.getUserByEmail(email)).uid; } catch { /* aún no entra */ }
    if (uid && (await db.doc(`users/${uid}`).get()).exists) {
      await auth.setCustomUserClaims(uid, { role });
      await db.doc(`users/${uid}`).update({ role, displayName, active: true });
      console.log(`✓ ${email}: perfil actualizado a ${role}`);
    } else {
      await db.doc(`invites/${email}`).set({ email, displayName, role, createdAt: Date.now(), createdBy: 'bootstrap' });
      console.log(`✓ ${email}: invitado como ${role} (entra con Google)`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
