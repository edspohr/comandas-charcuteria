// Product category slugs and their user-visible labels. The order of the
// keys defines display order across the catalog / wizard product picker.
export const CATEGORY_LABEL: Record<string, string> = {
  'cocidos': 'Charcutería cocida',
  'madurados': 'Charcutería madurada',
  'longanizas': 'Longanizas y vienesas ahumadas',
  'untables': 'Untables',
  'charqui': 'Charqui',
  'tablas': 'Tablas charcuteras',
  'quesos': 'Quesos',
  'otros': 'Otros',
};

const ORDER = Object.keys(CATEGORY_LABEL);
export function categoryOrder(slug: string): number {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABEL[slug] ?? slug;
}

// Bsale mezcla familias con presentaciones (p. ej. «Sachet unitario»).
// Conservamos una familia comercial explícita; para categorías heredadas,
// clasificamos por nombre sin cambiar identificadores ni variantes.
export function commercialCategory(name: string, source: string): string {
  if (CATEGORY_LABEL[source] && source !== 'otros') return source;
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/longaniz|chistorr|priet[ao]|vienes|butifarr/.test(n)) return 'longanizas';
  if (/queso/.test(n)) return 'quesos';
  if (/jamon.*pavo|mortadel|pastrami|jamon.*cocid/.test(n)) return 'cocidos';
  if (/fuet|salame|salami|prosciutto|serrano|coppa|bresaola/.test(n)) return 'madurados';
  if (/untable|sobrasada|pate\b/.test(n)) return 'untables';
  if (/charqui/.test(n)) return 'charqui';
  if (/tabla/.test(n)) return 'tablas';
  return 'otros';
}
