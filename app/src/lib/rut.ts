// RUT chileno: normalización, validación (módulo 11) y formato 12.345.678-K.
export function cleanRut(raw: string): string {
  return raw.replace(/[^0-9kK]/g, '').toUpperCase();
}

export function isValidRut(raw: string): boolean {
  const c = cleanRut(raw);
  if (c.length < 8 || c.length > 9) return false;
  const body = c.slice(0, -1);
  const dv = c.slice(-1);
  let sum = 0; let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
  return dv === expected;
}

export function formatRut(raw: string): string {
  const c = cleanRut(raw);
  if (c.length < 2) return c;
  const body = c.slice(0, -1); const dv = c.slice(-1);
  return `${Number(body).toLocaleString('es-CL')}-${dv}`;
}
