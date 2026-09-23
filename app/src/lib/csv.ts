// Minimal CSV export: UTF-8 with BOM (so Excel en español opens it with
// acentos), `;` separator (es-CL locale expects it), numbers untouched.
export function toCsv(input: Array<object>, columns?: Array<{ key: string; label: string }>): string {
  const rows = input as Array<Record<string, unknown>>;
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(';'));
  return [head, ...body].join('\n');
}

export function downloadCsv(filename: string, rows: Array<object>, columns?: Array<{ key: string; label: string }>): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
