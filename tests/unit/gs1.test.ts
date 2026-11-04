import { describe, expect, it } from 'vitest';
import { eanCheckOk, gs1Date, parseLabel } from '../../app/src/domain/gs1';
import { parseTed } from '../../app/src/domain/ted';

const GS = '\u001d';

describe('GS1-128', () => {
  it('lee GTIN, peso neto, vencimiento y lote con separador y prefijo ]C1', () => {
    const l = parseLabel(`]C1010780123456789431020012501726043010L-4587${GS}21000123`);
    expect(l.kind).toBe('gs1');
    expect(l.gtin).toBe('07801234567894');
    expect(l.netKg).toBe(12.5);
    expect(l.expiry).toBe('2026-04-30');
    expect(l.lot).toBe('L-4587');
    expect(l.serial).toBe('000123');
  });

  it('lee el texto legible con paréntesis', () => {
    const l = parseLabel('(01)17891234567892(3103)024315(13)261101(10)ABC12');
    expect(l.gtin).toBe('17891234567892');
    expect(l.netKg).toBe(24.315);
    expect(l.packDate).toBe('2026-11-01');
    expect(l.lot).toBe('ABC12');
  });

  it('convierte libras (320n) a kg y separa el peso bruto (330n)', () => {
    const l = parseLabel('01007612345678983202006000' + '3301000250');
    expect(l.netKg).toBeCloseTo(27.216, 3);
    expect(l.grossKg).toBe(25);
  });

  it('día 00 es el último día del mes', () => {
    expect(gs1Date('260200')).toBe('2026-02-28');
    expect(gs1Date('261399')).toBeUndefined();
  });

  it('EAN-13 de peso variable: peso supuesto en gramos', () => {
    const l = parseLabel('2012345012508', 'EAN-13');
    expect(l.kind).toBe('peso_variable');
    expect(l.code).toBe('2012345');
    expect(l.netKg).toBe(1.25);
    expect(l.weightAssumed).toBe(true);
  });

  it('EAN común sin peso', () => {
    const l = parseLabel('7801234567894', 'EAN-13');
    expect(l.kind).toBe('ean');
    expect(l.code).toBe('7801234567894');
    expect(eanCheckOk('7801234567894')).toBe(true);
  });

  it('un texto que no es GS1 queda como «otro» con su código', () => {
    const l = parseLabel('LOMO-VET-123', 'Code128');
    expect(l.kind).toBe('otro');
    expect(l.code).toBe('LOMO-VET-123');
  });
});

describe('Timbre electrónico', () => {
  const ted = '<TED version="1.0"><DD><RE>76123456-7</RE><TD>33</TD><F>004512</F><FE>2026-11-03</FE><RR>77654321-K</RR><RSR>CECINAS MARCOSI SPA</RSR><MNT>1543700</MNT><IT1>PULPA CERDO &amp; PALETA</IT1><CAF version="1.0"><DA>…</DA></CAF><TSTED>2026-11-03T09:12:00</TSTED></DD><FRMT algoritmo="SHA1withRSA">abc</FRMT></TED>';
  it('lee emisor, tipo, folio, fecha y monto', () => {
    const t = parseTed(ted)!;
    expect(t.rutEmisor).toBe('76123456-7');
    expect(t.tipo).toBe(33);
    expect(t.folio).toBe('4512');
    expect(t.fecha).toBe('2026-11-03');
    expect(t.monto).toBe(1543700);
    expect(t.item1).toBe('PULPA CERDO & PALETA');
  });
  it('devuelve null si no es un timbre', () => {
    expect(parseTed('hola')).toBeNull();
  });
});
