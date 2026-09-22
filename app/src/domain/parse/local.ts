import Fuse from 'fuse.js';
import type { Product, ProductFormat, Unit } from '@/domain/types';

// Rule-based parser for pasted WhatsApp orders.
// Splits text into lines/phrases, matches product name via Fuse.js,
// picks the best format from qty + unit hints, extracts qty via regex.
// Deliberately conservative: unknown items surface for the user to fix.

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

interface HaystackEntry {
  productId: string;
  productName: string;
  needle: string;
}

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Regexes for qty extraction — order matters (longer patterns first).
const QTY_PATTERNS: Array<{ re: RegExp; unit: Unit; conv?: (n: number) => number }> = [
  { re: /(\d+(?:[.,]\d+)?)\s*k(?:g|ilo|ilos)?\b/i,       unit: 'kg' },
  { re: /(\d+(?:[.,]\d+)?)\s*g(?:r|ramos)?\b/i,          unit: 'g'      },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:sachet|sobres?|paquete|paquetes|pote|potes)\b/i, unit: 'unidad' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:pieza|piezas|piezas?\.)\b/i, unit: 'unidad' },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:un|u|und|unidades?)\b/i, unit: 'unidad' },
  { re: /^\s*(\d+(?:[.,]\d+)?)\b/,                        unit: 'unidad' },
];

// Format hints — extra tokens after quantity that pin a specific format.
const FORMAT_HINTS: Array<{ tokens: RegExp; formatIdHint: string }> = [
  { tokens: /\bsachet\s*5\s*k/i,      formatIdHint: 'sachet-5kg' },
  { tokens: /\bsachet\s*1\s*k/i,      formatIdHint: 'sachet-1kg' },
  { tokens: /\b500\s*g|\bsachet\s*500/i, formatIdHint: 'sachet-500g' },
  { tokens: /\b200\s*g|\bsachet\s*200/i, formatIdHint: 'sachet-200g' },
  { tokens: /\bgranel|\blaminado/i,   formatIdHint: 'granel-kg' },
  { tokens: /\bpieza\s*entera|\bpieza/i, formatIdHint: 'pieza' },
  { tokens: /\bx\s*12\b/i,            formatIdHint: 'sachet-x12' },
  { tokens: /\bx\s*3\b/i,             formatIdHint: 'sachet-x3' },
  { tokens: /\bpote\s*250/i,          formatIdHint: 'pote-250g' },
  { tokens: /\bpote\s*150|\bpote/i,   formatIdHint: 'pote-150g' },
];

// Extract note-y content: things after a dash, in parens, or after keywords.
const NOTE_KEYWORDS = /\b(laminado\s+fino|sin\s+jugo|empaque\s+transparente|urgente|fino|grueso|entero)\b/gi;

function extractQty(text: string): { qty: number; unit: Unit; matchedText: string } | null {
  for (const { re, unit } of QTY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const raw = m[1].replace(',', '.');
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) return { qty: n, unit, matchedText: m[0] };
    }
  }
  return null;
}

function pickFormat(product: Product, raw: string, extractedUnit: Unit | undefined): ProductFormat | undefined {
  // 1. Explicit format hint
  for (const hint of FORMAT_HINTS) {
    if (hint.tokens.test(raw)) {
      const fmt = product.formats.find((f) => f.formatId === hint.formatIdHint);
      if (fmt) return fmt;
    }
  }
  // 2. Format that matches the extracted unit exactly (single candidate)
  if (extractedUnit) {
    const bySearchUnit = product.formats.filter((f) => f.unit === extractedUnit);
    if (bySearchUnit.length === 1) return bySearchUnit[0];
    // If unit is 'kg' and only granel exists → pick it
    if (extractedUnit === 'kg') {
      const granel = product.formats.find((f) => f.unit === 'kg');
      if (granel) return granel;
    }
  }
  // 3. Fallback: first format
  return product.formats[0];
}

function extractNotes(raw: string, qtyMatch?: string): string | undefined {
  const withoutQty = qtyMatch ? raw.replace(qtyMatch, ' ') : raw;
  const notes: string[] = [];
  const kw = withoutQty.match(NOTE_KEYWORDS);
  if (kw) notes.push(...kw);
  // dash or paren note (only content after a dash)
  const paren = withoutQty.match(/\(([^)]+)\)/);
  if (paren) notes.push(paren[1].trim());
  return notes.length ? [...new Set(notes.map((s) => s.toLowerCase()))].join(', ') : undefined;
}

function splitBlocks(text: string): string[] {
  return text
    .split(/[\n;•·]+|(?<=\d)\s*,\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 200);
}

export function parseLocal(text: string, products: Product[]): ParsedLine[] {
  const haystack: HaystackEntry[] = [];
  for (const p of products) {
    if (p.discontinued || !p.active) continue;
    haystack.push({ productId: p.id, productName: p.name, needle: norm(p.name) });
    for (const alias of p.aliases ?? []) {
      haystack.push({ productId: p.id, productName: p.name, needle: norm(alias) });
    }
  }
  const fuse = new Fuse(haystack, {
    keys: ['needle'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 3,
  });

  const productById = new Map(products.map((p) => [p.id, p]));
  const results: ParsedLine[] = [];

  for (const raw of splitBlocks(text)) {
    const normalized = norm(raw);
    const qtyInfo = extractQty(raw);
    const matches = fuse.search(normalized).slice(0, 3);

    if (matches.length === 0) {
      results.push({ raw, status: 'not_found' });
      continue;
    }
    const best = matches[0];
    const prod = productById.get(best.item.productId);
    if (!prod) { results.push({ raw, status: 'not_found' }); continue; }

    const fmt = pickFormat(prod, raw, qtyInfo?.unit);
    const notes = extractNotes(raw, qtyInfo?.matchedText);
    const scoreOk = (best.score ?? 0) < 0.25;
    const qtyOk = qtyInfo != null;
    const otherStrong = matches.length > 1 && (matches[1].score ?? 1) - (best.score ?? 0) < 0.05;
    const status: MatchStatus = scoreOk && qtyOk && !otherStrong ? 'verified' : 'review';

    // If the qty was expressed in grams and we chose a unit-based format (sachet 200g), convert
    let qty = qtyInfo?.qty;
    if (qty != null && qtyInfo!.unit === 'g' && fmt?.unit === 'unidad' && fmt.grams) {
      qty = Math.max(1, Math.round(qty / fmt.grams));
    }

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
      suggestions: matches.slice(0, 3).map((m) => ({ productId: m.item.productId, productName: m.item.productName })),
    });
  }

  return results;
}
