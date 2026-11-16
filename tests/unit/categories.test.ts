import { expect, it } from 'vitest';
import { commercialCategory } from '../../app/src/domain/categories';
it('separa familia comercial y presentación sin cambiar categorías explícitas', () => {
  expect(commercialCategory('Longaniza Sachet', 'sachet unitario')).toBe('longanizas');
  expect(commercialCategory('Jamón Pavo', 'sachet unitario')).toBe('cocidos');
  expect(commercialCategory('Queso de cabra', 'sin tipo')).toBe('quesos');
  expect(commercialCategory('Fuet cranberry', 'sin tipo')).toBe('madurados');
  expect(commercialCategory('Producto', 'tablas')).toBe('tablas');
});
