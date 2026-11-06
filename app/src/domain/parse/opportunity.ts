import { getAI, getGenerativeModel, Schema, VertexAIBackend } from '@firebase/ai';
import { app } from '@/data/firebase';
import type { NextActionType } from '@/domain/opportunities';

// Oportunidad dictada (Fase 5, visita del 05-11): Ciro graba un audio
// («quiero que Rafael visite al Bistró Ñuñoa el jueves por el guanciale») y
// Gemini lo devuelve ordenado. Nada se crea sin la confirmación en pantalla:
// el vendedor, el cliente y los productos se cruzan después con los datos de
// la app (domain/oppMatch.ts).

const REGION = 'us-central1';
const MODEL_NAME = 'gemini-2.5-flash';
const TIMEOUT_MS = 45000;

export interface DictatedOpportunity {
  transcript: string;
  ownerName: string | null;
  clientName: string | null;
  clientRut: string | null;
  title: string | null;
  products: string[];
  actionType: NextActionType | null;
  date: string | null;     // YYYY-MM-DD
  notes: string | null;
}

let cached: ReturnType<typeof getGenerativeModel> | null = null;
function model() {
  if (cached) return cached;
  const ai = getAI(app, { backend: new VertexAIBackend(REGION) });
  const responseSchema = Schema.object({
    properties: {
      transcript: Schema.string({ description: 'Lo que se dijo, transcrito fielmente en español.' }),
      ownerName: Schema.string({ nullable: true, description: 'Ejecutivo al que se asigna (uno de la lista), o null si no se menciona.' }),
      clientName: Schema.string({ nullable: true, description: 'Cliente o prospecto tal como se nombró (nombre del local o razón social).' }),
      clientRut: Schema.string({ nullable: true, description: 'RUT chileno si se dicta.' }),
      title: Schema.string({ nullable: true, description: 'Qué se busca, en una frase corta e imperativa (p. ej. «Ofrecer guanciale y prosciutto para la carta»).' }),
      products: Schema.array({ items: Schema.string(), description: 'Productos de interés, con el nombre del catálogo cuando calce.' }),
      actionType: Schema.enumString({ enum: ['visita', 'llamada', 'muestra', 'otro'], nullable: true, description: 'Primera acción: visita, llamada, llevar muestra u otro.' }),
      date: Schema.string({ nullable: true, description: 'Fecha de la primera acción en formato YYYY-MM-DD, resolviendo «mañana», «el jueves», «la próxima semana» desde la fecha de hoy.' }),
      notes: Schema.string({ nullable: true, description: 'Todo lo demás útil para el vendedor (contacto, horario, contexto). Sin repetir lo anterior.' }),
    },
    required: ['transcript', 'products'],
  });
  cached = getGenerativeModel(ai, {
    model: MODEL_NAME,
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
    systemInstruction: [
      'Sos el asistente comercial de La Charcutería Artesanal (Santiago de Chile). El jefe de ventas dicta en español chileno oportunidades comerciales para su equipo y vos las ordenás.',
      'Reglas:',
      '- ownerName: solo uno de los ejecutivos de la lista que se te pasa (el más parecido a lo que se dijo); si no se menciona a nadie, null.',
      '- clientName: el nombre del local, restaurante o empresa como se dijo. No inventes.',
      '- products: los productos de charcutería mencionados, escritos como en el catálogo si calzan (coppa, guanciale, prosciutto, longaniza…).',
      '- date: resolvé fechas relativas a partir de la fecha de hoy que se te indica. Si no hay fecha, null.',
      '- Si un dato no está en el audio, devolvé null: la persona lo completa en la pantalla de confirmación.',
    ].join('\n'),
  });
  return cached;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export async function readDictatedOpportunity(input: { audio?: { base64: string; mimeType: string }; text?: string }, ctx: { today: string; executives: string[]; products: string[] }): Promise<DictatedOpportunity> {
  const [y, m, d] = ctx.today.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  const prompt = [
    `Hoy es ${weekday} ${ctx.today}.`,
    `Ejecutivos: ${ctx.executives.join(', ') || '(ninguno)'}.`,
    `Catálogo (nombres): ${ctx.products.join(', ')}.`,
    '',
    input.audio ? 'Se adjunta el AUDIO con la oportunidad dictada. Transcribilo y ordenalo.' : 'Oportunidad escrita:',
    input.text ?? '',
  ].join('\n');
  const parts = input.audio ? [prompt, { inlineData: { mimeType: input.audio.mimeType, data: input.audio.base64 } }] : [prompt];
  const call = model().generateContent(parts);
  const raw = await new Promise<Awaited<typeof call>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('La lectura tardó demasiado. Intente de nuevo o escriba la oportunidad.')), TIMEOUT_MS);
    call.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
  const p = JSON.parse(raw.response.text()) as Partial<DictatedOpportunity>;
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
  return {
    transcript: p.transcript ?? input.text ?? '',
    ownerName: p.ownerName ?? null, clientName: p.clientName ?? null, clientRut: p.clientRut ?? null,
    title: p.title ?? null, products: (p.products ?? []).filter(Boolean),
    actionType: p.actionType ?? null, date, notes: p.notes ?? null,
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
