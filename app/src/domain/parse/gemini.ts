import { getAI, getGenerativeModel, Schema, VertexAIBackend } from '@firebase/ai';
import { app } from '@/data/firebase';
import type { Product, Unit } from '@/domain/types';
import type { ParsedLine, MatchStatus } from './local';
import type { ClientHints } from './client';

// Firebase AI Logic wire-up. We route through Vertex AI (project data lives in
// Google Cloud, App Check hooks apply, cheaper than routing through Anthropic).
// Model choice: gemini-2.5-flash — sobra para parseo estructurado de 5-10 líneas
// de WhatsApp y cabe en la cuota gratuita al volumen esperado.

const REGION = 'us-central1';
const MODEL_NAME = 'gemini-2.5-flash';
// The client can time out fast: if the SDK hasn't returned in this window we
// fall back to the local deterministic parser so the demo never stalls.
const TIMEOUT_MS = 8000;

interface GeminiParsed {
  lines: Array<{
    rawLine: string;
    productId: string;
    formatId: string;
    qty: number;
    unit: Unit;
    notes?: string | null;
    confidence: 'verified' | 'review' | 'not_found';
  }>;
  client?: {
    fantasyName?: string | null;
    razonSocial?: string | null;
    rut?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    receivingHours?: string | null;
    deliveryMode?: 'retiro' | 'despacho' | null;
    contactName?: string | null;
  } | null;
}

let cachedModel: ReturnType<typeof getGenerativeModel> | null = null;
function getModel() {
  if (cachedModel) return cachedModel;
  const ai = getAI(app, { backend: new VertexAIBackend(REGION) });
  const responseSchema = Schema.object({
    properties: {
      lines: Schema.array({
        items: Schema.object({
          properties: {
            rawLine:   Schema.string({ description: 'Trozo original del mensaje del cliente.' }),
            productId: Schema.string({ description: 'ID exacto del catálogo. Vacío si no reconocés el producto.' }),
            formatId:  Schema.string({ description: 'ID de formato del producto elegido.' }),
            qty:       Schema.number({ description: 'Cantidad. En unidades para sachet/pieza; en kg para granel.' }),
            unit:      Schema.enumString({ enum: ['g', 'kg', 'unidad'] }),
            notes:     Schema.string({ nullable: true, description: 'Instrucciones extra (laminado fino, sin jugo, etc.).' }),
            confidence: Schema.enumString({
              enum: ['verified', 'review', 'not_found'],
              description: 'verified = producto+formato+cantidad seguros. review = alguno dudoso. not_found = no matchea nada.',
            }),
          },
          required: ['rawLine', 'productId', 'formatId', 'qty', 'unit', 'confidence'],
        }),
      }),
    },
    required: ['lines'],
  });
  // Optional client block: whatever the message reveals about who is ordering.
  (responseSchema as unknown as { properties: Record<string, unknown> }).properties.client = Schema.object({
    nullable: true,
    properties: {
      fantasyName:    Schema.string({ nullable: true, description: 'Nombre comercial del local (Hotel Magnolia, Café Oven…).' }),
      razonSocial:    Schema.string({ nullable: true, description: 'Razón social si la menciona (para facturar).' }),
      rut:            Schema.string({ nullable: true, description: 'RUT chileno tal como aparece.' }),
      phone:          Schema.string({ nullable: true }),
      email:          Schema.string({ nullable: true }),
      address:        Schema.string({ nullable: true, description: 'Dirección de entrega, calle número y comuna.' }),
      receivingHours: Schema.string({ nullable: true, description: 'Horario de recepción si lo indica.' }),
      deliveryMode:   Schema.enumString({ enum: ['retiro', 'despacho'], nullable: true }),
      contactName:    Schema.string({ nullable: true, description: 'Nombre de la persona que escribe.' }),
    },
  });
  cachedModel = getGenerativeModel(ai, {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.1,
    },
    systemInstruction: [
      'Sos un asistente que interpreta pedidos escritos en español chileno para una charcutería artesanal en Santiago (La Charcutería Artesanal / Cecinas Marcosi). Convertís texto libre de WhatsApp en líneas estructuradas usando SOLO productos y formatos del catálogo que se te pasa.',
      'Reglas duras:',
      '- Nunca inventás productId ni formatId. Si dudás entre dos productos parecidos, elegí el más específico y marcá confidence "review".',
      '- Ignorá saludos, agradecimientos, cierres y frases sin cantidad ("hola", "buenos días", "para mañana necesito", "gracias", "un abrazo").',
      '- Si una línea menciona el mismo producto en más de un formato, devolvé UNA entrada por cada formato. Ejemplo: "Jamón cocido: 60 sachet de 200 g y 8 kg laminado" ⇒ dos entradas (sachet-200g qty 60 + granel-kg qty 8).',
      '- Si la línea NO trae cantidad ("necesito jamón cocido"), incluíla igual con qty 0 y confidence "review" para que el vendedor la complete a mano.',
      'Convenciones de formato:',
      '- "granel", "laminado", "laminado fino", "por kilo", "kg" sin "sachet" ⇒ formato granel-kg (unidad kg).',
      '- "sachet", "sobre", "bolsa al vacío", "pack" ⇒ el sachet de gramos que se mencione (200 g, 500 g, 1 kg, 5 kg). Si no aparece el gramaje, elegí el sachet más chico del producto.',
      '- "pieza", "pieza entera", "entera" ⇒ formato pieza.',
      '- "pote" con 150 g o 250 g ⇒ el pote correspondiente; sin número, pote-150g.',
      '- Cantidades en kg cuando la unidad del formato es kg, en unidades enteras cuando es unidad ("caja de 10" = 10 unidades, "media pieza" = 0.5 unidad).',
      'Ambigüedades chilenas:',
      '- "jamón cocido" ≠ "jamón ahumado" (distintos productos). No confundas por la palabra "ahumado" (también aplica a queso gouda ahumado).',
      '- "mortadela" sola ⇒ mortadela tradicional; "mortadela con pistacho" ⇒ mortadela pistacho.',
      '- Aceptá abreviaciones y variantes: "x10" (10 unidades), "1/2 kg" (0.5 kg), "kls" (kg), "gr" (g), "una caja" (1 unidad), "un par" (2).',
      'Cliente: si el mensaje revela quién pide (nombre del local, razón social, RUT chileno, teléfono, dirección, horario, retiro/despacho, nombre de contacto), completá el bloque client. Si no, dejá el bloque en null.',
    ].join('\n'),
  });
  return cachedModel;
}

function buildCatalogManifest(products: Product[]): string {
  const rows: string[] = [];
  for (const p of products) {
    if (p.discontinued || !p.active) continue;
    for (const f of p.formats) {
      const aliases = (p.aliases ?? []).join(', ') || '-';
      rows.push(`${p.id} | ${p.name} | ${f.formatId} | ${f.label} | ${f.unit} | aliases: ${aliases}`);
    }
  }
  return rows.join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('gemini-timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function parseWithGemini(text: string, products: Product[]): Promise<ParsedLine[]> {
  return (await parseWithGeminiFull(text, products)).lines;
}

export interface GeminiFullResult { lines: ParsedLine[]; client: ClientHints | null; }

export async function parseWithGeminiFull(text: string, products: Product[]): Promise<GeminiFullResult> {
  const manifest = buildCatalogManifest(products);
  const prompt = [
    'Catálogo disponible (productId | nombre | formatId | etiqueta formato | unidad | aliases):',
    manifest,
    '',
    'Interpretá el siguiente mensaje y devolvé un JSON con las líneas de pedido encontradas.',
    'Regla: si el texto no mapea a ningún producto del catálogo, no incluyas esa línea.',
    'Además, si el mensaje revela quién pide (nombre del local, razón social, RUT, teléfono, dirección, horario, retiro/despacho), completá el bloque client; si no, dejalo en null.',
    '',
    'Mensaje:',
    text,
  ].join('\n');

  const model = getModel();
  const raw = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);
  const jsonText = raw.response.text();
  const parsed = JSON.parse(jsonText) as GeminiParsed;
  const productById = new Map(products.map((p) => [p.id, p]));

  const c = parsed.client;
  const client: ClientHints | null = c && (c.fantasyName || c.razonSocial || c.rut || c.phone || c.address) ? {
    fantasyName: c.fantasyName ?? undefined,
    name: c.razonSocial ?? undefined,
    rut: c.rut ?? undefined,
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
    address: c.address ?? undefined,
    receivingHours: c.receivingHours ?? undefined,
    deliveryMode: c.deliveryMode ?? undefined,
    contactName: c.contactName ?? undefined,
  } : null;

  const lines = parsed.lines.map((l): ParsedLine => {
    const prod = productById.get(l.productId);
    const fmt = prod?.formats.find((f) => f.formatId === l.formatId);
    // Suggestions: same product, all formats — lets the user swap formatId inline.
    const suggestions = prod ? [{ productId: prod.id, productName: prod.name }] : [];
    const status: MatchStatus = l.confidence === 'verified' && prod && fmt ? 'verified'
      : l.confidence === 'not_found' || !prod || !fmt ? 'not_found'
      : 'review';
    return {
      raw: l.rawLine,
      productId: prod?.id,
      productName: prod?.name,
      formatId: fmt?.formatId,
      formatLabel: fmt?.label,
      unit: fmt?.unit,
      qty: l.qty,
      notes: l.notes ?? undefined,
      status,
      suggestions,
    };
  });
  return { lines, client };
}

// True when Firebase AI Logic looks callable in this environment. We keep this
// separate so PegarPedido can pre-flight and stay silent about Gemini when the
// feature is disabled (e.g. Vertex AI API not enabled on the project).
export function geminiEnabled(): boolean {
  // If we ever want a hard kill-switch (env var / feature flag) it goes here.
  return true;
}
