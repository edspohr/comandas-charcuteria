// Comuna y ciudad para la ficha de cliente en Bsale. Comandas guarda la
// dirección en un solo texto («Av. Italia 1450, Ñuñoa»); Bsale las pide por
// separado (municipality = comuna, city = ciudad) y el SII las exige en la
// factura. Se toma la comuna del final de la dirección si es una de la Región
// Metropolitana; si no se reconoce, se usa «Santiago» (como la facturación).

const RM_COMUNAS = [
  'Alhué', 'Buin', 'Calera de Tango', 'Cerrillos', 'Cerro Navia', 'Colina', 'Conchalí', 'Curacaví',
  'El Bosque', 'El Monte', 'Estación Central', 'Huechuraba', 'Independencia', 'Isla de Maipo',
  'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Lampa', 'Las Condes',
  'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú', 'María Pinto', 'Melipilla', 'Ñuñoa',
  'Padre Hurtado', 'Paine', 'Pedro Aguirre Cerda', 'Peñaflor', 'Peñalolén', 'Pirque', 'Providencia',
  'Pudahuel', 'Puente Alto', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Bernardo',
  'San Joaquín', 'San José de Maipo', 'San Miguel', 'San Pedro', 'San Ramón', 'Santiago', 'Talagante',
  'Tiltil', 'Vitacura',
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const BY_NORM = new Map(RM_COMUNAS.map((c) => [norm(c), c]));
BY_NORM.set('santiago centro', 'Santiago');
BY_NORM.set('stgo', 'Santiago');
BY_NORM.set('stgo centro', 'Santiago');

export const DEFAULT_COMUNA = 'Santiago';
export const DEFAULT_CITY = 'Santiago';

/** Comuna reconocida en la dirección (último tramo con coma que calce), o null. */
export function comunaFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => norm(p)).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const hit = BY_NORM.get(parts[i]);
    if (hit) return hit;
  }
  return null;
}

/** municipality y city para Bsale; con dirección y sin comuna reconocida, Santiago. */
export function bsaleLocality(address?: string | null, city?: string | null): { municipality?: string; city?: string } {
  if (!address && !city) return {};
  return { municipality: comunaFromAddress(address) ?? DEFAULT_COMUNA, city: city || DEFAULT_CITY };
}
