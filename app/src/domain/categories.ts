// Product category slugs and their user-visible labels. The order of the
// keys defines display order across the catalog / wizard product picker.
export const CATEGORY_LABEL: Record<string, string> = {
  'cocidos': 'Charcutería cocida',
  'madurados': 'Charcutería madurada',
  'longanizas': 'Longanizas y vienesas ahumadas',
  'untables': 'Untables',
  'charqui': 'Charqui',
  'tablas': 'Tablas charcuteras',
};

const ORDER = Object.keys(CATEGORY_LABEL);
export function categoryOrder(slug: string): number {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABEL[slug] ?? slug;
}
