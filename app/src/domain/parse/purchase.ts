import { getAI, getGenerativeModel, Schema, VertexAIBackend } from '@firebase/ai';
import { app } from '@/data/firebase';
import type { InlineImage } from './gemini';

// Lectura con Gemini de documentos de compra (factura o guía) y de etiquetas
// de cajas, para Compras e insumos (ADR-0017). Misma configuración que el
// intérprete de pedidos (ADR-0011): Vertex AI con App Check, sin «thinking».

const REGION = 'us-central1';
const MODEL_NAME = 'gemini-2.5-flash';
const TIMEOUT_MS = 60000;

export interface DocRead {
  docKind: 'factura' | 'guia' | 'otro';
  folio?: string;
  issuedAt?: string;
  supplierRut?: string;
  supplierName?: string;
  netCLP?: number;
  totalCLP?: number;
  guideFolio?: string;
  lines: Array<{ description: string; code?: string; qty?: number; unit?: 'kg' | 'unidad' | 'otro'; unitPrice?: number; total?: number }>;
}

export interface LabelRead {
  description?: string;
  code?: string;
  netKg?: number;
  lot?: string;
  expiry?: string;
  prodDate?: string;
}

const s = (description?: string) => Schema.string({ nullable: true, description });
const n = (description?: string) => Schema.number({ nullable: true, description });

let docModel: ReturnType<typeof getGenerativeModel> | null = null;
let labelModel: ReturnType<typeof getGenerativeModel> | null = null;

function model(kind: 'doc' | 'label') {
  if (kind === 'doc' && docModel) return docModel;
  if (kind === 'label' && labelModel) return labelModel;
  const ai = getAI(app, { backend: new VertexAIBackend(REGION) });
  const responseSchema = kind === 'doc'
    ? Schema.object({
      properties: {
        docKind: Schema.enumString({ enum: ['factura', 'guia', 'otro'] }),
        folio: s('Número de folio del documento (N°), solo dígitos.'),
        issuedAt: s('Fecha de emisión en formato YYYY-MM-DD.'),
        supplierRut: s('RUT del EMISOR (el proveedor, arriba a la derecha en el recuadro rojo), tal como aparece.'),
        supplierName: s('Razón social del emisor.'),
        netCLP: n('Monto neto en pesos.'),
        totalCLP: n('Monto total en pesos.'),
        guideFolio: s('Si es factura y referencia una guía de despacho, el folio de esa guía.'),
        lines: Schema.array({
          items: Schema.object({
            properties: {
              description: Schema.string({ description: 'Descripción del producto tal como aparece.' }),
              code: s('Código del producto del proveedor, si aparece.'),
              qty: n('Cantidad.'),
              unit: Schema.enumString({ enum: ['kg', 'unidad', 'otro'], nullable: true, description: 'kg si la cantidad es en kilos (KG, KGS, KILO).' }),
              unitPrice: n('Precio unitario neto.'),
              total: n('Total neto de la línea.'),
            },
            required: ['description'],
          }),
        }),
      },
      required: ['docKind', 'lines'],
    })
    : Schema.object({
      properties: {
        description: s('Nombre del producto o corte.'),
        code: s('Código de producto o GTIN impreso bajo el código de barras.'),
        netKg: n('Peso NETO en kg (si está en libras, convertir).'),
        lot: s('Lote.'),
        expiry: s('Fecha de vencimiento en YYYY-MM-DD.'),
        prodDate: s('Fecha de producción o faena en YYYY-MM-DD.'),
      },
    });
  const m = getGenerativeModel(ai, {
    model: MODEL_NAME,
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
    systemInstruction: kind === 'doc'
      ? 'Leés documentos tributarios chilenos de compra (factura electrónica, guía de despacho) fotografiados en la recepción de una fábrica de cecinas. Devolvés la cabecera y TODAS las líneas de detalle. Las cifras chilenas usan punto para miles y coma para decimales: "1.234,5 KG" = 1234.5. No inventes datos: si algo no se lee, null.'
      : 'Leés etiquetas de cajas de carne y otros insumos (en español, portugués o inglés). Devolvés producto, peso neto en kg, lote y fechas. "PESO LÍQUIDO"/"NET WT" es el neto. No inventes datos: si algo no se lee, null.',
  });
  if (kind === 'doc') docModel = m; else labelModel = m;
  return m;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('La lectura con IA tardó demasiado. Intente de nuevo o escriba los datos a mano.')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '')) as T;

// Varias fotos (páginas) o un PDF del mismo documento van en una sola lectura.
export async function readPurchaseDocument(files: InlineImage | InlineImage[]): Promise<DocRead> {
  const parts = (Array.isArray(files) ? files : [files]).map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } }));
  const intro = parts.length > 1 ? `Leé este documento de compra (${parts.length} archivos: son páginas del mismo documento).` : 'Leé este documento de compra.';
  const r = await withTimeout(model('doc').generateContent([intro, ...parts]), TIMEOUT_MS);
  const parsed = JSON.parse(r.response.text()) as DocRead;
  return { ...clean(parsed), docKind: parsed.docKind ?? 'otro', lines: (parsed.lines ?? []).map((l) => clean(l)).filter((l) => l.description) };
}

export async function readLabelPhoto(image: InlineImage): Promise<LabelRead> {
  const r = await withTimeout(model('label').generateContent(['Leé esta etiqueta.', { inlineData: { mimeType: image.mimeType, data: image.base64 } }]), TIMEOUT_MS);
  return clean(JSON.parse(r.response.text()) as LabelRead);
}
