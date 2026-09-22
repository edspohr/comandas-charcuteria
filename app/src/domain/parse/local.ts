import Fuse from 'fuse.js';
import type { Product, ProductFormat, Unit } from '@/domain/types';

// Rule-based parser for pasted WhatsApp orders.
// Splits text into candidate lines, discards greetings/headers, extracts a
// qty via regex, then scores each catalog needle by how well it appears
// *inside* the line (contains + token overlap + Fuse fallback).

export type MatchStatus = 'verified' | 'review' | 'not_found';

export interface ParsedLine {
  raw: string;
  productId?: string;
  productName?: string;
  formatId?: string;
  formatLabel?: string;
  unit?: Unit;
  qty?: number;
  notes?: string;
  status: MatchStatus;
  suggestions?: Array<{ productId: string; productName: string }>;
}

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'sin', 'para', 'por', 'y', 'o', 'un', 'una', 'uno']);
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));

// Regexes for qty extraction — order matters (longer patterns first).
// Sachet 5kg / 500g etc. detection wins over bare grams.
const QTY_PATTERNS: Array<{ re: RegExp; unit: Unit; formatHint?: string }> = [
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet\s*)?5\s*k(?:g|ilo|ilos)?\b/i,  unit: 'unidad', formatHint: 'sachet-5kg' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet\s*)?1\s*k(?:g|ilo|ilos)?\b/i,  unit: 'unidad', formatHint: 'sachet-1kg' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet\s*)?500\s*g\b/i,               unit: 'unidad', formatHint: 'sachet-500g' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet\s*)?200\s*g\b/i,               unit: 'unidad', formatHint: 'sachet-200g' },
  { re: /(\d+(?:[.,]\d+)?)\s*k(?:g|ilo|ilos)?\b/i,                    unit: 'kg' },
  { re: /(\d+(?:[.,]\d+)?)\s*g(?:r|ramos)?\b/i,                       unit: 'g' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet|sobres?|paquetes?)\b/i,        unit: 'unidad' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:piezas?)\b/i,                         unit: 'unidad', formatHint: 'pieza' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:potes?)\b/i,                          unit: 'unidad' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:un|u|und|unidades?)\b/i,              unit: 'unidad' },
  { re: /^\s*[-•·]?\s*(\d+(?:[.,]\d+)?)\b/,                            unit: 'unidad' },
];

// Format hints — extra tokens that pin a specific format when the qty regex didn't already fix it.
// Order matters: more specific tokens (250 g pote) come before the generic pote fallback.
const FORMAT_HINTS: Array<{ tokens: RegExp; formatIdHint: string }> = [
  { tokens: /\bgranel|\blaminado/i,          formatIdHint: 'granel-kg' },
  { tokens: /\bpieza\s*entera|\bpieza/i,     formatIdHint: 'pieza' },
  { tokens: /\bx\s*12\b/i,                    formatIdHint: 'sachet-x12' },
  { tokens: /\bx\s*3\b/i,                     formatIdHint: 'sachet-x3' },
  { tokens: /\bpote[\s\w]*?250|250[\s\w]*?pote/i, formatIdHint: 'pote-250g' },
  { tokens: /\bpote[\s\w]*?150|150[\s\w]*?pote/i, formatIdHint: 'pote-150g' },
  { tokens: /\bpote/i,                        formatIdHint: 'pote-150g' },
];

// Note keywords: extra hints ("laminado fino", "sin jugo") that describe HOW to
// pack the line, not the product itself. Words that appear in a product name
// (e.g. "pistacho" in "Mortadela pistacho") are filtered out below in
// extractNotes so we don't leave notes like `notas: "pistacho"` on the mortadela.
const NOTE_KEYWORDS = /\b(laminado\s+fino|sin\s+jugo|empaque\s+transparente|urgente|fino|grueso|entero|arandanos|cranberries|pistacho|picante)\b/gi;

// Discard greetings, closings, thanks — anything without a digit or with < 6 chars.
const GREETING_RE = /^(hola|buen[oa]s?|gracias|saludos|abrazo|para|necesito|solicito|listo|ok)[\s!,.:;-]*/i;

function extractQty(text: string): { qty: number; unit: Unit; matchedText: string; formatHint?: string } | null {
  for (const p of QTY_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const raw = m[1].replace(',', '.');
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) return { qty: n, unit: p.unit, matchedText: m[0], formatHint: p.formatHint };
    }
  }
  return null;
}

function pickFormat(product: Product, raw: string, extractedUnit: Unit | undefined, qtyHint: string | undefined): ProductFormat | undefined {
  if (qtyHint) {
    const fmt = product.formats.find((f) => f.formatId === qtyHint);
    if (fmt) return fmt;
  }
  for (const hint of FORMAT_HINTS) {
    if (hint.tokens.test(raw)) {
      const fmt = product.formats.find((f) => f.formatId === hint.formatIdHint);
      if (fmt) return fmt;
    }
  }
  if (extractedUnit) {
    const byUnit = product.formats.filter((f) => f.unit === extractedUnit);
    if (byUnit.length === 1) return byUnit[0];
    if (extractedUnit === 'kg') {
      const granel = product.formats.find((f) => f.unit === 'kg');
      if (granel) return granel;
    }
  }
  return product.formats[0];
}

function extractNotes(raw: string, qtyMatch: string | undefined, productName: string): string | undefined {
  const withoutQty = qtyMatch ? raw.replace(qtyMatch, ' ') : raw;
  const productTokens = new Set(tokens(productName));
  const notes: string[] = [];
  const kw = withoutQty.match(NOTE_KEYWORDS);
  if (kw) {
    for (const raw of kw) {
      // Drop tokens that already appear in the product name; otherwise
      // "Mortadela pistacho 1,5 kg" would leave notes="pistacho".
      const parts = raw.toLowerCase().split(/\s+/);
      if (parts.some((p) => productTokens.has(norm(p)))) continue;
      notes.push(raw.toLowerCase());
    }
  }
  const paren = withoutQty.match(/\(([^)]+)\)/);
  if (paren) notes.push(paren[1].trim());
  return notes.length ? [...new Set(notes)].join(', ') : undefined;
}

function splitBlocks(text: string): string[] {
  return text
    .split(/[\n;•·]+|(?<=\d\s*[a-z]{0,4})\s*,\s+/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s.length < 200);
}

// Score how well a candidate needle (product name / alias) appears inside a line.
// Rewards contiguous substring (best), token overlap, and prefix matches. Zero
// when the needle's core tokens don't appear at all. Needle length is a small
// tiebreaker so multi-token needles beat single-token aliases at the same score
// (Gouda ahumado > jamon ahumado on "gouda ahumado 200g").
function scoreMatch(lineNorm: string, lineTokens: string[], needle: string, needleTokens: string[]): number {
  if (needleTokens.length === 0) return 0;
  if (lineNorm.includes(needle)) return 1 + needleTokens.length * 0.01;
  const overlap = needleTokens.filter((t) => lineTokens.some((lt) => lt === t || lt.startsWith(t) || t.startsWith(lt))).length;
  const ratio = overlap / needleTokens.length;
  return ratio >= 0.5 ? 0.4 + ratio * 0.5 + needleTokens.length * 0.01 : 0;
}

interface NeedleEntry { productId: string; productName: string; needle: string; tokens: string[]; }

export function parseLocal(text: string, products: Product[]): ParsedLine[] {
  const needles: NeedleEntry[] = [];
  for (const p of products) {
    if (p.discontinued || !p.active) continue;
    needles.push({ productId: p.id, productName: p.name, needle: norm(p.name), tokens: tokens(p.name) });
    for (const a of p.aliases ?? []) {
      needles.push({ productId: p.id, productName: p.name, needle: norm(a), tokens: tokens(a) });
    }
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  // Fuse for typo-tolerant fallback when the substring scoring misses (e.g. "chorico" vs "chorizo").
  const fuse = new Fuse(needles, {
    keys: ['needle'],
    threshold: 0.35,
    includeScore: true,
    minMatchCharLength: 4,
    ignoreLocation: true,
  });

  const results: ParsedLine[] = [];

  for (const raw of splitBlocks(text)) {
    if (GREETING_RE.test(raw) && !/\d/.test(raw)) continue;

    const lineNorm = norm(raw);
    const lineTokens = tokens(raw);
    const qtyInfo = extractQty(raw);

    // Score every needle by "does its name appear in the line", keep best per product.
    const bestByProduct = new Map<string, { entry: NeedleEntry; score: number }>();
    for (const n of needles) {
      const s = scoreMatch(lineNorm, lineTokens, n.needle, n.tokens);
      if (s <= 0) continue;
      const prev = bestByProduct.get(n.productId);
      if (!prev || s > prev.score) bestByProduct.set(n.productId, { entry: n, score: s });
    }
    let ranked = [...bestByProduct.values()].sort((a, b) => b.score - a.score);

    // Fuse fallback for typos — search each token of the line against the needle set.
    if (ranked.length === 0 && lineTokens.length > 0) {
      const guesses = new Map<string, number>();
      for (const t of lineTokens) {
        const hits = fuse.search(t).slice(0, 3);
        for (const h of hits) {
          const cur = guesses.get(h.item.productId) ?? 0;
          const s = 1 - (h.score ?? 1);
          if (s > cur) guesses.set(h.item.productId, s);
        }
      }
      ranked = [...guesses.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pid, score]) => {
          const n = needles.find((x) => x.productId === pid)!;
          return { entry: n, score };
        });
    }

    if (ranked.length === 0) {
      results.push({ raw, status: 'not_found' });
      continue;
    }

    const best = ranked[0];
    const prod = productById.get(best.entry.productId);
    if (!prod) { results.push({ raw, status: 'not_found' }); continue; }

    const fmt = pickFormat(prod, raw, qtyInfo?.unit, qtyInfo?.formatHint);
    const notes = extractNotes(raw, qtyInfo?.matchedText, prod.name);

    // Grams → sachet-of-N-grams conversion when the format is a fixed sachet.
    let qty = qtyInfo?.qty;
    if (qty != null && qtyInfo!.unit === 'g' && fmt?.unit === 'unidad' && fmt.grams) {
      qty = Math.max(1, Math.round(qty / fmt.grams));
    }
    // For sachet formats where the qty parser resolved to 'unidad' directly (e.g. "12 sachet 500g"),
    // qty is already the count of sachets — no conversion needed.

    const scoreOk = best.score >= 0.75;
    const qtyOk = qty != null && qty > 0;
    const ambiguous = ranked.length > 1 && ranked[1].score >= best.score * 0.9;
    const status: MatchStatus = scoreOk && qtyOk && !ambiguous ? 'verified' : (qtyOk || scoreOk ? 'review' : 'review');

    results.push({
      raw,
      productId: prod.id,
      productName: prod.name,
      formatId: fmt?.formatId,
      formatLabel: fmt?.label,
      unit: fmt?.unit,
      qty,
      notes,
      status,
      suggestions: ranked.slice(0, 3).map((r) => ({ productId: r.entry.productId, productName: r.entry.productName })),
    });
  }

  return results;
}
