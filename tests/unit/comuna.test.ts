import { describe, expect, it } from 'vitest';
import { bsaleLocality, comunaFromAddress } from '../../functions/src/bsale/comuna';

describe('comuna para Bsale', () => {
  it('toma la comuna del final de la dirección', () => {
    expect(comunaFromAddress('Av. Italia 1450, Ñuñoa')).toBe('Ñuñoa');
    expect(comunaFromAddress('Av. Bilbao 1234, Providencia, Santiago')).toBe('Santiago');
    expect(comunaFromAddress('Ruta 68 km 12, pudahuel')).toBe('Pudahuel');
    expect(comunaFromAddress('Franklin 741, nunoa')).toBe('Ñuñoa');
    expect(comunaFromAddress('Nueva de Lyon 072, Providencia , RM')).toBe('Providencia');
  });
  it('no inventa comunas', () => {
    expect(comunaFromAddress('Antonia López de Bello 24')).toBeNull();
    expect(comunaFromAddress('Calle Larga 10, Viña del Mar')).toBeNull();
    expect(comunaFromAddress(undefined)).toBeNull();
  });
  it('rellena municipality y city', () => {
    expect(bsaleLocality('Av. Italia 1450, Ñuñoa')).toEqual({ municipality: 'Ñuñoa', city: 'Santiago' });
    expect(bsaleLocality('Antonia López de Bello 24')).toEqual({ municipality: 'Santiago', city: 'Santiago' });
    expect(bsaleLocality(undefined)).toEqual({});
  });
});
