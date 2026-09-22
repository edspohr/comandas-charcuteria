import type { Client } from '../../app/src/domain/types.ts';

const c = (
  id: string,
  name: string,
  opts: Partial<Omit<Client, 'id' | 'name'>> = {},
): Client => ({
  id,
  name,
  deliveryMode: opts.deliveryMode ?? 'despacho',
  invoicingComplete: opts.invoicingComplete ?? (!!opts.rut && !!opts.giro && !!opts.address),
  ...opts,
});

export const clients: Client[] = [
  c('tienda',              'Tienda La Charcutería',   { fantasyName: 'Tienda', rut: '77.123.456-7', giro: 'Elaboración de embutidos', address: 'Av. Providencia 1234, Providencia', receivingHours: 'L-D 10:00-20:00', deliveryMode: 'retiro', isInternalShop: true, invoicingComplete: true }),

  c('hotel-magnolia',      'Hotel Magnolia',          { fantasyName: 'Magnolia', rut: '76.888.111-2', giro: 'Hotelería', address: 'Huérfanos 539, Santiago Centro', receivingHours: 'L-V 08:00-15:00', contactPhone: '+56 2 2664 4043', email: 'compras@hotelmagnolia.cl' }),

  c('santa-brasa-vitacura','Santa Brasa Vitacura',    { fantasyName: 'Santa Brasa Vitacura', rut: '76.500.200-8', giro: 'Restaurante', address: 'Av. Vitacura 6250', receivingHours: 'L-V 09:00-14:00', notes: 'Facturar a Alimentos San Martín SpA', contactPhone: '+56 9 8412 3344' }),
  c('santa-brasa-nueva-costanera','Santa Brasa Nueva Costanera', { fantasyName: 'Santa Brasa NC', rut: '76.500.200-8', giro: 'Restaurante', address: 'Nueva Costanera 3892', receivingHours: 'L-V 09:00-14:00' }),
  c('santa-brasa-la-dehesa','Santa Brasa La Dehesa',  { fantasyName: 'Santa Brasa LD', rut: '76.500.200-8', giro: 'Restaurante', address: 'Av. La Dehesa 1201', receivingHours: 'L-V 09:00-14:00' }),
  c('santa-brasa-central', 'Alimentos San Martín SpA (bodega central)', { fantasyName: 'Santa Brasa Central', rut: '76.500.200-8', giro: 'Comercialización de alimentos', address: 'Ruta 68 km 12, Pudahuel', receivingHours: 'L-V 07:00-15:00', notes: 'Recepción bodega, longaniza chillán 5 kg' }),

  c('emporio-dulce-vida',  'Emporio Dulce Vida',      { fantasyName: 'Dulce Vida', rut: '77.201.415-K', giro: 'Emporio', address: 'Av. Los Leones 220, Providencia', receivingHours: 'L-S 09:00-13:00 / 15:00-19:00', contactPhone: '+56 9 5544 2211' }),

  c('carloto',             'Carloto Pizzería',        { fantasyName: 'Carloto', rut: '76.987.312-4', giro: 'Restaurante', address: 'Nueva de Lyon 072, Providencia', receivingHours: 'L-D 11:00-17:00' }),

  c('impasto',             'Impasto',                 { fantasyName: 'Impasto', rut: '77.301.550-1', giro: 'Restaurante', address: 'Av. Vitacura 4363', receivingHours: 'L-V 10:00-15:00' }),

  c('bakery-to-go',        'Bakery To Go',            { fantasyName: 'Bakery To Go', rut: '77.412.918-6', giro: 'Panadería', address: 'Av. Bilbao 1234, Providencia', receivingHours: 'L-D 07:00-11:00' }),

  c('fran-gc',             'Fran GC SpA',             { fantasyName: 'Fran GC', rut: '76.222.881-9', giro: 'Distribución de alimentos', address: 'Bodega 12, San Bernardo' }),

  c('charcuteria-garcia',  'Charcutería García',      { fantasyName: 'García', rut: '77.100.233-K', giro: 'Charcutería', address: 'Av. Manuel Montt 550, Providencia', receivingHours: 'L-S 10:00-19:00' }),

  c('oven-chile',          'Oven Chile',              { fantasyName: 'Oven', rut: '76.333.720-2', giro: 'Restaurante', address: 'Isidora Goyenechea 3000', receivingHours: 'L-V 10:00-15:00' }),

  c('cafeteria-sofa',      'Cafetería Sofá',          { fantasyName: 'Sofá', address: 'Antonia López de Bello 24, Recoleta', notes: 'Datos de facturación incompletos', invoicingComplete: false }),

  c('hotel-costanera',     'Hotel Costanera',         { fantasyName: 'Costanera', rut: '76.700.101-3', giro: 'Hotelería', address: 'Av. Andrés Bello 2233, Providencia', receivingHours: 'L-V 08:00-16:00' }),

  c('yamba',               'YAMBA',                   { fantasyName: 'YAMBA', rut: '77.505.900-K', giro: 'Restaurante', address: 'Av. Kennedy 5735', receivingHours: 'L-V 09:00-14:00' }),
];
