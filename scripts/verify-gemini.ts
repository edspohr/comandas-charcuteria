// Smoke test para la interpretación con Gemini (Firebase AI Logic / Vertex AI).
//
// Corre solo si hay credenciales: usa `service-account.json` en la raíz
// (o `GOOGLE_APPLICATION_CREDENTIALS` en el entorno) para llamar directo a la
// REST API de Vertex AI (`aiplatform.googleapis.com`). Es lo más cercano posible
// a lo que hace el cliente `@firebase/ai` desde el browser sin levantar el
// browser: valida que el proyecto pueda facturar tokens, que el modelo esté
// disponible en us-central1, y que la respuesta traiga el JSON estructurado
// que el UI espera.
//
// Uso:
//   npx tsx scripts/verify-gemini.ts
//
// Si no hay credenciales o falla la carga del módulo google-auth, el script
// imprime "SKIP" y termina 0 para que sea seguro correrlo en CI local.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? 'comandas-charcuteria';
const LOCATION = 'us-central1';
const MODEL = 'gemini-2.5-flash';

const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? resolve(process.cwd(), 'service-account.json');

interface ServiceAccount { client_email: string; private_key: string; }

interface Case { label: string; text: string; check: (lines: any[]) => string | null; }
const CASES: Case[] = [
  {
    label: 'línea compuesta ⇒ 2 entradas',
    text: 'Jamón cocido: 60 sachet de 200 g y 8 kg laminado',
    check: (lines) => {
      const sachet = lines.find((l) => l.productId === 'jamon-cocido' && l.formatId === 'sachet-200g' && Number(l.qty) === 60);
      const granel = lines.find((l) => l.productId === 'jamon-cocido' && l.formatId === 'granel-kg' && Number(l.qty) === 8);
      return sachet && granel ? null : `esperaba sachet-200g×60 + granel-kg×8, recibió ${JSON.stringify(lines)}`;
    },
  },
  {
    label: 'cocido vs ahumado ⇒ productos distintos',
    text: '10 sachet de jamón cocido 200g y 10 sachet jamón ahumado 200g',
    check: (lines) => {
      const cocido = lines.find((l) => l.productId === 'jamon-cocido');
      const ahumado = lines.find((l) => l.productId === 'jamon-ahumado');
      return cocido && ahumado ? null : `esperaba jamon-cocido + jamon-ahumado, recibió ${lines.map((l) => l.productId).join(', ')}`;
    },
  },
];

const CATALOG = [
  'jamon-cocido | Jamón Cocido Artesanal | sachet-200g | Sachet 200 g | unidad',
  'jamon-cocido | Jamón Cocido Artesanal | granel-kg | Granel (kg) | kg',
  'jamon-ahumado | Jamón de Pierna Ahumado Artesanal | sachet-200g | Sachet 200 g | unidad',
  'jamon-ahumado | Jamón de Pierna Ahumado Artesanal | granel-kg | Granel (kg) | kg',
].join('\n');

const SYSTEM = [
  'Sos un asistente que interpreta pedidos escritos en español chileno para una charcutería artesanal en Santiago. Devolvés SOLO JSON con {"lines":[{productId, formatId, qty, unit}]}.',
  'Reglas: nunca inventés IDs, ignorá saludos, y si una línea menciona el mismo producto en dos formatos devolvé DOS entradas. "laminado"/"granel"/"por kilo" ⇒ granel-kg. "sachet" ⇒ el sachet del gramaje mencionado.',
  'Catálogo:',
  CATALOG,
].join('\n');

async function main() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.log(`SKIP · verify-gemini · no credentials at ${CREDENTIALS_PATH}`);
    return;
  }
  const sa = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    console.log('SKIP · verify-gemini · credentials file missing client_email/private_key');
    return;
  }

  let GoogleAuth: any;
  try {
    ({ GoogleAuth } = await import('google-auth-library'));
  } catch {
    console.log('SKIP · verify-gemini · google-auth-library not resolvable');
    return;
  }

  const auth = new GoogleAuth({
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const token = await auth.getAccessToken();
  if (!token) {
    console.error('❌ no se pudo obtener token de Google');
    process.exit(1);
  }

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  let ok = 0;
  const errs: string[] = [];
  let totalMs = 0;

  for (const c of CASES) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: c.text }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            lines: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  productId: { type: 'STRING' },
                  formatId:  { type: 'STRING' },
                  qty:       { type: 'NUMBER' },
                  unit:      { type: 'STRING', enum: ['g', 'kg', 'unidad'] },
                },
                required: ['productId', 'formatId', 'qty', 'unit'],
              },
            },
          },
          required: ['lines'],
        },
      },
    };
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      errs.push(`[${c.label}] fetch error: ${(e as Error).message}`);
      continue;
    }
    const ms = Date.now() - t0;
    totalMs += ms;
    if (res.status === 403) {
      const txt = await res.text();
      console.log(`SKIP · verify-gemini · 403 (la cuenta de servicio no tiene roles/aiplatform.user).`);
      console.log(`  Detalle: ${txt.slice(0, 200)}`);
      console.log(`  Otorgar con: gcloud projects add-iam-policy-binding ${PROJECT_ID} \\\n    --member=serviceAccount:${sa.client_email} --role=roles/aiplatform.user`);
      console.log(`  Nota: esto es solo para este script; el navegador usa Firebase AI Logic (firebasevertexai.googleapis.com) y no requiere este rol.`);
      return;
    }
    if (!res.ok) {
      const txt = await res.text();
      errs.push(`[${c.label}] HTTP ${res.status} · ${txt.slice(0, 300)}`);
      continue;
    }
    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { errs.push(`[${c.label}] respuesta sin text: ${JSON.stringify(data).slice(0, 300)}`); continue; }
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { errs.push(`[${c.label}] JSON inválido: ${text.slice(0, 200)}`); continue; }
    const err = c.check(parsed.lines ?? []);
    if (err) errs.push(`[${c.label}] ${err} (${ms} ms)`);
    else { ok++; console.log(`  ✓ ${c.label} · ${ms} ms`); }
  }

  console.log(`\nGemini cases: ${ok}/${CASES.length} · promedio ${Math.round(totalMs / CASES.length)} ms`);
  if (errs.length) {
    console.error(`\n❌ ${errs.length} failure(s):`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('✅ Gemini smoke OK');
}

main().catch((e) => { console.error('❌ verify-gemini crashed:', e); process.exit(1); });
