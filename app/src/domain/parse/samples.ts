import type { Product } from '../types';
import { SAMPLE_DEFAULT_GRAMS, parseSampleMentions, sampleLine } from '../samples';
import { parseLocal, type ParsedLine } from './local';

// Pedido IA: "incluir muestra de roast beef 80 gr" no es una línea a cobrar.
// Después de interpretar (Gemini o local) se quitan las líneas que salieron de
// una mención de muestra y se agrega una línea de muestra por mención, con el
// producto resuelto por el matcher local.
const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function applySamples(lines: ParsedLine[], text: string, products: Product[]): ParsedLine[] {
  const mentions = parseSampleMentions(text);
  const isSampleText = (raw: string) => /\bmuestras?\b/.test(norm(raw));
  const kept = lines.filter((l) => l.sample || !isSampleText(l.raw));
  if (!mentions.length) return kept;
  const byId = new Map(products.map((p) => [p.id, p]));
  const samples: ParsedLine[] = mentions.map((m) => {
    const match = parseLocal(m.product, products)[0];
    const prod = match?.productId ? byId.get(match.productId) : undefined;
    const draft = prod ? sampleLine(prod, m.grams ?? SAMPLE_DEFAULT_GRAMS) : null;
    if (!prod || !draft) return { raw: m.raw, status: 'not_found', sample: true };
    return {
      raw: m.raw, productId: prod.id, productName: prod.name, formatId: draft.formatId, formatLabel: draft.formatLabel,
      unit: draft.unit, qty: draft.qty, sample: true, sampleGrams: draft.sampleGrams,
      status: match.status === 'not_found' ? 'review' : match.suggestions && match.suggestions.length > 1 && match.status !== 'verified' ? 'review' : 'verified',
      suggestions: match.suggestions,
    };
  });
  return [...kept, ...samples];
}
