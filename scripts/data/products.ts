import type { Product, ProductFormat } from '../../app/src/domain/types.ts';

// Catálogo transcrito del PDF oficial de La Charcutería (catálogo de agosto).
// Precios (CLP con IVA) del pricelist "Precios directos de fábrica al por mayor · Agosto".
// Tres tipos de precio por producto según el pricelist:
//   - Sachet: precio por unidad de sachet (fijo).
//   - Kilo Laminado (granel-kg): precio por kg de producto laminado.
//   - Kilo Pza (pieza): precio por kg × peso real de la pieza al facturar.

// ----- Helpers de formato

const sachet = (id: string, label: string, grams: number, priceCLP: number): ProductFormat =>
  ({ formatId: id, label, unit: 'unidad', grams, priceCLP });

const granel = (pricePerKgCLP: number): ProductFormat =>
  ({ formatId: 'granel-kg', label: 'Granel laminado (kg)', unit: 'kg', pricePerKgCLP });

const pieza = (avgWeightKg: number, pricePerKgCLP: number, label = 'Pieza entera'): ProductFormat =>
  ({ formatId: 'pieza', label, unit: 'unidad', pricePerKgCLP, avgWeightKg });

const p = (
  id: string,
  name: string,
  category: string,
  formats: ProductFormat[],
  opts: Partial<Pick<Product, 'discontinued' | 'active' | 'aliases'>> = {},
): Product => ({
  id, name, category,
  active: opts.active ?? true,
  discontinued: opts.discontinued ?? false,
  formats,
  aliases: opts.aliases,
});

export const products: Product[] = [
  // -------------------- LONGANIZAS - VIENESAS AHUMADAS --------------------
  p('butifarra', 'Butifarra', 'longanizas',
    [sachet('sachet-4u-400g', 'Sachet 4 unidades (400 g)', 400, 10400),
     granel(10400)]),

  p('longaniza-chillan', 'Longaniza tipo Chillán', 'longanizas',
    [sachet('sachet-4u-400g', 'Sachet 4 unidades (400 g)', 400, 10400),
     granel(10400)],
    { aliases: ['longaniza chillan', 'chillan'] }),

  p('longaniza-polaca', 'Longaniza Polaca', 'longanizas',
    [sachet('sachet-4u-400g', 'Sachet 4 unidades (400 g)', 400, 10400),
     granel(10400)]),

  p('mix-longanizas', 'Mix de Longanizas', 'longanizas',
    [sachet('sachet-4u-400g', 'Sachet 4 unidades (400 g)', 400, 10400),
     granel(10400)]),

  p('prieta', 'Prieta', 'longanizas',
    [sachet('sachet-2u-275g', 'Sachet 2 unidades (275 g)', 275, 10400)]),

  p('vienesa-frankfurt', 'Vienesa Frankfurt', 'longanizas',
    [sachet('sachet-5u-350g', 'Sachet 5 unidades (350 g)', 350, 10350)],
    { aliases: ['vienesa'] }),

  p('chistorra', 'Chistorra Ahumada', 'longanizas',
    [sachet('sachet-5u-350g', 'Sachet 5 unidades (350 g)', 350, 12000)]),

  // -------------------- PRODUCTOS MADURADOS --------------------
  p('bresaola', 'Bresaola', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 3000),
     granel(30000),
     pieza(1.75, 27370, 'Pieza entera (1,5–2 kg)')]),

  p('cabanossi-polaco', 'Cabanossi Polaco', 'madurados',
    [{ formatId: 'unidad-20g', label: 'Unidad 20 g', unit: 'unidad', grams: 20, priceCLP: 650 },
     { formatId: 'caja-20u',   label: 'Caja 20 unidades', unit: 'unidad', grams: 400, priceCLP: 13000 }],
    { aliases: ['cabanossi'] }),

  p('coppa', 'Coppa', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 2480),
     granel(24800),
     pieza(1.75, 23800, 'Pieza entera (1,5–2 kg)')]),

  p('chorizo-espanol', 'Chorizo Español', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 1690),
     granel(16900),
     pieza(2.25, 15600, 'Pieza entera (2–2,5 kg)')],
    { aliases: ['chorizo'] }),

  p('fuet-espanol', 'Fuet Español', 'madurados',
    [{ formatId: 'pieza-90g', label: 'Pieza 90 g', unit: 'unidad', grams: 90, priceCLP: 1700 }],
    { aliases: ['fuet'] }),

  p('fuet-cranberry', 'Fuet Cranberries', 'madurados',
    [{ formatId: 'pieza-90g', label: 'Pieza 90 g', unit: 'unidad', grams: 90, priceCLP: 2350 }],
    { aliases: ['fuet cranberries', 'fuet arandanos'] }),

  p('guanciale', 'Guanciale Madurado', 'madurados',
    [pieza(1.5, 22000, 'Pieza entera (1–2 kg)')]),

  p('lomo-embuchado', 'Lomo Embuchado', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 1900),
     granel(19000),
     pieza(1.25, 18000, 'Pieza entera (1–1,5 kg)')]),

  p('panceta-madurada', 'Panceta Madurada', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 2480),
     granel(24800),
     pieza(4.5, 23800, 'Pieza entera (4–5 kg)')]),

  p('pastirma-cerdo', 'Pastirma de Cerdo', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 2480),
     granel(24800),
     pieza(1.75, 23800, 'Pieza entera (1,5–2 kg)')]),

  p('pastirma-vacuno', 'Pastirma de Vacuno', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 3000),
     granel(30000),
     pieza(1.75, 27370, 'Pieza entera (1,5–2 kg)')]),

  p('pepperoni-madurado', 'Pepperoni Madurado', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 1660),
     granel(16600),
     pieza(2.15, 15600, 'Pieza entera (2–2,3 kg)')],
    { aliases: ['pepperoni'] }),

  p('salame-milano', 'Salame Milano', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 1760),
     granel(17600),
     pieza(3, 16600, 'Pieza entera (2,5–3,5 kg)')],
    { aliases: ['milano'] }),

  p('salame-angus', 'Salame Angus', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 2066),
     granel(20660),
     pieza(2.25, 19660, 'Pieza entera (2–2,5 kg)')],
    { aliases: ['angus'] }),

  p('salame-italiano', 'Salame Italiano', 'madurados',
    [sachet('sachet-100g', 'Sachet 100 g', 100, 1690),
     granel(16600),
     pieza(2.25, 15600, 'Pieza entera (2–2,5 kg)')],
    { aliases: ['italiano'] }),

  p('jamon-serrano', 'Jamón Serrano', 'madurados',
    [sachet('sachet-500g', 'Sachet 500 g', 500, 15000),
     granel(30000)]),

  // -------------------- CHARQUI --------------------
  p('charqui-vacuno', 'Charqui de Vacuno', 'charqui',
    [sachet('sachet-30g', 'Sachet 30 g', 30, 2700),
     granel(89100)],
    { aliases: ['charqui'] }),

  p('charqui-cerdo', 'Charqui de Cerdo', 'charqui',
    [sachet('sachet-30g', 'Sachet 30 g', 30, 2100),
     granel(60000)]),

  // -------------------- PRODUCTOS COCIDOS --------------------
  p('arrolado-huaso', 'Arrollado Huaso', 'cocidos',
    [pieza(1.75, 12500, 'Pieza entera (1,5–2 kg)')],
    { aliases: ['arrolado', 'arrollado'] }),

  p('porchetta', 'Porchetta', 'cocidos',
    [pieza(4.5, 23520, 'Pieza entera (4–5 kg, pedido mínimo 1 pieza)')]),

  p('chicharron', 'Chicharrón', 'cocidos',
    [{ formatId: 'granel-1kg', label: 'Granel 1 kg', unit: 'unidad', grams: 1000, priceCLP: 30000 }]),

  p('chuleta-kassler', 'Chuleta Kassler', 'cocidos',
    [{ formatId: 'sachet-2u', label: 'Sachet 2 unidades', unit: 'unidad', priceCLP: 9000 },
     granel(8490)]),

  p('jamon-cocido', 'Jamón Cocido Artesanal', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 2500),
     granel(12000),
     pieza(4.5, 12000, 'Pieza entera (4–5 kg)')],
    { aliases: ['jamon cocido'] }),

  p('jamon-ahumado', 'Jamón de Pierna Ahumado Artesanal', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 2600),
     granel(12500),
     pieza(4.5, 12500, 'Pieza entera (4–5 kg)')],
    { aliases: ['jamon ahumado', 'jamon de pierna'] }),

  p('gran-biscotto', 'Gran Biscotto', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 3000),
     granel(15000),
     pieza(4.5, 14268, 'Pieza entera (4–5 kg)')]),

  p('lomo-kassler', 'Lomo Kassler', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 2600),
     granel(13000),
     pieza(1.75, 11650, 'Pieza entera (1,5–2 kg)')],
    { aliases: ['kassler'] }),

  p('lomo-kassler-medallon', 'Lomo Kassler Medallón', 'cocidos',
    [{ formatId: 'caja-10u', label: 'Caja 10 unidades', unit: 'unidad', priceCLP: 8990 }]),

  p('mortadela-pistacho', 'Mortadela con Pistacho', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 2500),
     granel(12500),
     pieza(4, 11990, 'Pieza entera (4 kg)')],
    { aliases: ['mortadela'] }),

  p('pastrami-cerdo', 'Pastrami de Cerdo', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 2500),
     granel(12500),
     pieza(1.75, 11890, 'Pieza entera (1,5–2 kg)')]),

  p('pastrami-vacuno', 'Pastrami de Vacuno', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 4200),
     granel(21000),
     pieza(2.25, 20500, 'Pieza entera (2–2,5 kg)')]),

  p('panceta-ahumada', 'Panceta Ahumada', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 3500),
     granel(17500),
     pieza(4.5, 17500, 'Pieza entera (4–5 kg)')]),

  p('pastrami-americano', 'Pastrami Americano Tapapecho Angus', 'cocidos',
    [pieza(3.5, 27700, 'Pieza entera (3–4 kg)')],
    { aliases: ['tapapecho', 'pastrami americano', 'brisket'] }),

  p('queso-cabra-ahumado', 'Queso de Cabra Ahumado', 'cocidos',
    [pieza(4, 16730, 'Pieza entera (4 kg)')],
    { aliases: ['queso cabra'] }),

  p('queso-gouda-ahumado', 'Queso Gouda Ahumado', 'cocidos',
    [sachet('sachet-200g', 'Sachet 200 g', 200, 3250),
     granel(16250),
     pieza(3.75, 16053, 'Pieza entera (3,5–4 kg)')],
    { aliases: ['gouda', 'queso gouda'] }),

  p('salmon-ahumado', 'Salmón Ahumado', 'cocidos',
    [pieza(1, 40000, 'Pieza entera (1 kg)')]),

  // -------------------- PRODUCTOS UNTABLES --------------------
  p('pepperoni-untable', 'Pepperoni Untable', 'untables',
    [{ formatId: 'frasco-110g', label: 'Frasco 110 g', unit: 'unidad', grams: 110, priceCLP: 19990 }]),

  p('sobrasada-untable', 'Sobrasada Española Untable', 'untables',
    [{ formatId: 'frasco-200g', label: 'Frasco 200 g', unit: 'unidad', grams: 200, priceCLP: 22500 }],
    { aliases: ['sobrasada'] }),

  p('tocino-aleman-untable', 'Tocino Alemán Ahumado Untable', 'untables',
    [{ formatId: 'frasco-110g', label: 'Frasco 110 g', unit: 'unidad', grams: 110, priceCLP: 19990 }],
    { aliases: ['tocino aleman'] }),

  p('pate-campo', 'Paté de Campo', 'untables',
    [{ formatId: 'unidad-125g', label: 'Unidad 125 g', unit: 'unidad', grams: 125, priceCLP: 12000 }],
    { aliases: ['pate'] }),

  // -------------------- TABLAS CHARCUTERAS --------------------
  p('tabla-150', 'Tabla Charcutera 150 g', 'tablas',
    [{ formatId: 'tabla-150', label: 'Tabla 150 g', unit: 'unidad', grams: 150, priceCLP: 2990 }],
    { aliases: ['tabla 150'] }),

  p('tabla-200', 'Tabla Charcutera 200 g', 'tablas',
    [{ formatId: 'tabla-200', label: 'Tabla 200 g', unit: 'unidad', grams: 200, priceCLP: 4050 }],
    { aliases: ['tabla 200'] }),
];
