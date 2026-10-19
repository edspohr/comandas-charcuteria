// Copia users/{uid}.role al custom claim `role` de cada cuenta. Necesario una
// vez para los usuarios creados antes del modelo de perfiles (oct-2026): las
// reglas leen el claim y sin él no ven nada.
//
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrate-claims.ts            # muestra
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrate-claims.ts --apply

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const ROLES = ['vendedor', 'tienda', 'despacho', 'reparto', 'produccion', 'admin', 'superAdmin', 'consultor'];
const apply = process.argv.includes('--apply');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Falta GOOGLE_APPLICATION_CREDENTIALS (cuenta de servicio del proyecto real).');
  process.exit(1);
}
initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'comandas-charcuteria-demo' : 'comandas-charcuteria' });

async function main() {
  const auth = getAuth();
  const snap = await getFirestore().collection('users').get();
  let changed = 0;
  for (const d of snap.docs) {
    const { role, email } = d.data() as { role?: string; email?: string };
    if (!role || !ROLES.includes(role)) { console.log(`✗ ${email ?? d.id}: perfil "${role}" no válido, se omite`); continue; }
    let current: unknown;
    try { current = (await auth.getUser(d.id)).customClaims?.role; } catch { console.log(`✗ ${email ?? d.id}: sin cuenta en Auth`); continue; }
    if (current === role) continue;
    changed++;
    console.log(`${apply ? '✓' : '→'} ${email ?? d.id}: ${current ?? '(sin perfil)'} → ${role}`);
    if (apply) await auth.setCustomUserClaims(d.id, { role });
  }
  console.log(apply ? `Listo: ${changed} cuentas actualizadas.` : `${changed} cuentas por actualizar. Ejecute con --apply.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
