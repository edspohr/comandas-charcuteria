import type { Product } from '../../app/src/domain/types.ts';

const SACHET_200: Product['formats'][number] = { formatId: 'sachet-200g', label: 'Sachet 200 g', unit: 'unidad', grams: 200 };
const SACHET_500: Product['formats'][number] = { formatId: 'sachet-500g', label: 'Sachet 500 g', unit: 'unidad', grams: 500 };
const SACHET_1KG: Product['formats'][number] = { formatId: 'sachet-1kg',  label: 'Sachet 1 kg',  unit: 'unidad', grams: 1000 };
const SACHET_5KG: Product['formats'][number] = { formatId: 'sachet-5kg',  label: 'Sachet 5 kg',  unit: 'unidad', grams: 5000 };
const PIEZA:      Product['formats'][number] = { formatId: 'pieza',       label: 'Pieza entera', unit: 'unidad' };
const GRANEL:     Product['formats'][number] = { formatId: 'granel-kg',   label: 'Granel laminado (kg)', unit: 'kg' };
const POTE_150:   Product['formats'][number] = { formatId: 'pote-150g',   label: 'Pote 150 g',   unit: 'unidad', grams: 150 };
const POTE_250:   Product['formats'][number] = { formatId: 'pote-250g',   label: 'Pote 250 g',   unit: 'unidad', grams: 250 };

const p = (
  id: string,
  name: string,
  category: string,
  formats: Product['formats'],
  opts: Partial<Pick<Product, 'discontinued' | 'active' | 'aliases'>> = {},
): Product => ({
  id, name, category,
  active: opts.active ?? true,
  discontinued: opts.discontinued ?? false,
  formats,
  aliases: opts.aliases,
});

export const products: Product[] = [
  // Jamones cocidos y ahumados
  // Single-word aliases like 'cocido' / 'ahumado' were pulling generic
  // phrases (e.g. "gouda ahumado x 10") into the wrong product. Keep only
  // the full two-word form.
  p('jamon-cocido',           'Jamón cocido',            'jamones',   [SACHET_200, SACHET_500, SACHET_1KG, PIEZA, GRANEL], { aliases: ['jamon cocido'] }),
  p('jamon-ahumado',          'Jamón ahumado',           'jamones',   [SACHET_200, SACHET_500, PIEZA, GRANEL], { aliases: ['jamon ahumado'] }),
  p('lomo-kassler',           'Lomo Kassler',            'jamones',   [SACHET_200, SACHET_500, PIEZA, GRANEL], { aliases: ['kassler'] }),
  p('pastrami-vacuno',        'Pastrami vacuno',         'pastramis', [SACHET_200, SACHET_500, PIEZA, GRANEL], { aliases: ['pastrami res'] }),
  p('pastrami-cerdo',         'Pastrami cerdo',          'pastramis', [SACHET_200, SACHET_500, PIEZA, GRANEL]),
  p('pastirma-vacuno',        'Pastirma de vacuno',      'pastramis', [PIEZA], { discontinued: true, active: false, aliases: ['pastirma'] }),

  // Mortadelas
  // 'pistacho' alone matched too eagerly; 'mortadela' is fine as it uniquely maps.
  p('mortadela-pistacho',     'Mortadela pistacho',      'mortadelas', [SACHET_200, PIEZA, GRANEL], { aliases: ['mortadela'] }),
  p('mortadela-clasica',      'Mortadela clásica',       'mortadelas', [SACHET_200, PIEZA, GRANEL]),

  // Salames
  p('salame-italiano',        'Salame italiano',         'salames',   [PIEZA, GRANEL], { aliases: ['italiano'] }),
  p('salame-milano',          'Salame Milano',           'salames',   [PIEZA, GRANEL], { aliases: ['milano'] }),
  p('salame-angus',           'Salame Angus',            'salames',   [PIEZA, GRANEL], { aliases: ['angus'] }),
  p('salame-campesino',       'Salame campesino',        'salames',   [PIEZA, GRANEL]),
  p('coppa',                  'Coppa',                   'salames',   [PIEZA, GRANEL]),

  // Chorizos y fuet
  p('chorizo-espanol',        'Chorizo español',         'chorizos',  [SACHET_200, PIEZA, GRANEL], { aliases: ['chorizo'] }),
  p('fuet-tradicional',       'Fuet tradicional',        'chorizos',  [PIEZA]),
  p('fuet-cranberries',       'Fuet con cranberries',    'chorizos',  [PIEZA], { aliases: ['fuet arandanos'] }),

  // Cabanossi
  p('cabanossi-x3',           'Cabanossi x3',            'cabanossi', [{ formatId: 'sachet-x3', label: 'Sachet x3 unidades', unit: 'unidad', grams: 180 }], { aliases: ['cabanossi 3'] }),
  p('cabanossi-x12',          'Cabanossi x12',           'cabanossi', [{ formatId: 'sachet-x12', label: 'Sachet x12 unidades', unit: 'unidad', grams: 720 }], { aliases: ['cabanossi 12'] }),

  // Embutidos frescos
  p('longaniza-chillan',      'Longaniza chillán',       'embutidos-frescos', [SACHET_500, SACHET_1KG, SACHET_5KG], { aliases: ['longaniza', 'chillan'] }),
  p('longaniza-polaca',       'Longaniza polaca',        'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('butifarra',              'Butifarra',               'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('prieta',                 'Prieta',                  'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('chistorra',              'Chistorra',               'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('choricillo',             'Choricillo',              'embutidos-frescos', [SACHET_500, SACHET_1KG]),

  // Carnes curadas
  p('brisket',                'Brisket ahumado',         'carnes-curadas', [PIEZA, GRANEL], { aliases: ['brisket ahumado'] }),
  p('guanciale',              'Guanciale',               'carnes-curadas', [PIEZA, GRANEL]),
  p('panceta-curada',         'Panceta curada',          'carnes-curadas', [PIEZA, GRANEL]),
  p('bacon-ahumado',          'Bacon ahumado',           'carnes-curadas', [SACHET_200, SACHET_500, GRANEL], { aliases: ['tocino'] }),

  // Quesos ahumados
  p('gouda-ahumado',          'Queso Gouda ahumado',     'quesos',    [SACHET_200, SACHET_500, PIEZA, GRANEL], { aliases: ['gouda'] }),
  p('cabra-ahumado',          'Queso de cabra ahumado',  'quesos',    [PIEZA, GRANEL], { aliases: ['queso cabra'] }),

  // Tablas charcuteras
  p('tabla-120',              'Tabla charcutera 120 g',  'tablas',    [{ formatId: 'tabla-120', label: 'Tabla 120 g', unit: 'unidad', grams: 120 }], { aliases: ['tabla 120'] }),
  p('tabla-150',              'Tabla charcutera 150 g',  'tablas',    [{ formatId: 'tabla-150', label: 'Tabla 150 g', unit: 'unidad', grams: 150 }]),
  p('tabla-200',              'Tabla charcutera 200 g',  'tablas',    [{ formatId: 'tabla-200', label: 'Tabla 200 g', unit: 'unidad', grams: 200 }]),
  p('tabla-250',              'Tabla charcutera 250 g',  'tablas',    [{ formatId: 'tabla-250', label: 'Tabla 250 g', unit: 'unidad', grams: 250 }]),

  // Untables
  p('pate-campesino',         'Paté campesino',          'untables',  [POTE_150, POTE_250]),
  p('pate-hongos',            'Paté de hongos',          'untables',  [POTE_150, POTE_250]),
  p('rillette-cerdo',         'Rillette de cerdo',       'untables',  [POTE_150, POTE_250]),
  p('mantequilla-tocino',     'Mantequilla de tocino',   'untables',  [POTE_150]),

  // Charqui
  p('charqui-vacuno',         'Charqui de vacuno',       'charqui',   [SACHET_200, GRANEL], { aliases: ['charqui'] }),
  p('charqui-cerdo',          'Charqui de cerdo',        'charqui',   [SACHET_200, GRANEL]),

  // Otros
  p('salchicha-parrillera',   'Salchicha parrillera',    'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('salchicha-viena',        'Salchicha viena',         'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('morcilla',               'Morcilla',                'embutidos-frescos', [SACHET_500, SACHET_1KG]),
  p('speck',                  'Speck',                   'jamones',   [PIEZA, GRANEL]),
  p('prosciutto',             'Prosciutto crudo',        'jamones',   [PIEZA, GRANEL]),
  p('lardo',                  'Lardo curado',            'carnes-curadas', [PIEZA, GRANEL]),
  p('cecina-chilena',         'Cecina chilena',          'carnes-curadas', [SACHET_200, GRANEL], { aliases: ['cecina'] }),
  p('salame-picante',         'Salame picante',          'salames',   [PIEZA, GRANEL]),
  p('sopressata',             'Sopressata',              'salames',   [PIEZA, GRANEL]),
  p('nduja',                  '’Nduja',              'untables',  [POTE_150]),
];
