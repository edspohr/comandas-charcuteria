// Product category slugs and their user-visible labels. The order of the
// keys defines display order across the catalog / wizard product picker.
export const CATEGORY_LABEL: Record<string, string> = {
  'jamones': 'Jamones',
  'pastramis': 'Pastramis',
  'mortadelas': 'Mortadelas',
  'salames': 'Salames',
  'chorizos': 'Chorizos y fuet',
  'cabanossi': 'Cabanossi',
  'embutidos-frescos': 'Embutidos frescos',
  'carnes-curadas': 'Carnes curadas',
  'quesos': 'Quesos',
  'tablas': 'Tablas charcuteras',
  'untables': 'Untables y patés',
  'charqui': 'Charqui',
};

const ORDER = Object.keys(CATEGORY_LABEL);
export function categoryOrder(slug: string): number {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABEL[slug] ?? slug;
}
