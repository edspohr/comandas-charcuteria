import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

// Cliente HTTP de la API de Bsale (https://docs.bsale.dev). Solo corre en
// Cloud Functions: el token vive en Secret Manager y nunca llega al browser.
//
// Supuestos tomados de la documentación pública (oct-2026), a verificar con
// el primer diagnóstico real (bsaleDiagnose deja la respuesta cruda):
//   - Base https://api.bsale.io/v1, header `access_token`.
//   - Listas paginadas { href, count, limit, offset, items, next }, limit ≤ 50.
//   - Fechas como epoch en segundos (emissionDate, etc.).
//   - Ante 429 / 5xx se reintenta con backoff.

export const BSALE_TOKEN = defineSecret('BSALE_ACCESS_TOKEN');

const BASE_URL = process.env.BSALE_BASE_URL ?? 'https://api.bsale.io';
const PAGE = 50;
const MAX_PAGES = 400; // 20.000 filas por recurso: holgado para una fábrica de este tamaño
const MAX_RETRIES = 4;

export interface BsaleList<T> {
  href?: string;
  count?: number;
  limit?: number;
  offset?: number;
  items?: T[];
  next?: string;
}

export class BsaleHttpError extends Error {
  constructor(public status: number, public path: string, public body: unknown) {
    super(`Bsale ${status} en ${path}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BsaleApi {
  private calls = 0;
  constructor(private token: string) {
    if (!token) throw new Error('BSALE_ACCESS_TOKEN no configurado.');
  }

  get callCount() { return this.calls; }

  private async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/v') ? '' : '/v1'}${path}`;
    for (let attempt = 0; ; attempt++) {
      this.calls++;
      const res = await fetch(url, {
        method,
        headers: { access_token: this.token, 'content-type': 'application/json', accept: 'application/json' },
        body: body != null && method !== 'GET' ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
      if (res.ok) return data as T;
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < MAX_RETRIES) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
        logger.warn(`[bsale] ${res.status} ${method} ${path}, reintento en ${wait} ms`);
        await sleep(wait);
        continue;
      }
      throw new BsaleHttpError(res.status, path, data);
    }
  }

  get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    return this.request<T>('GET', withQuery(path, params));
  }

  // Walks a paginated list. Follows `next` when Bsale gives it and falls
  // back to offset arithmetic otherwise.
  async getAll<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.get<BsaleList<T>>(path, { ...params, limit: PAGE, offset });
      const items = res?.items ?? [];
      out.push(...items);
      if (items.length < PAGE || (res.count != null && out.length >= res.count)) break;
      offset += PAGE;
    }
    return out;
  }

  post<T>(path: string, body: unknown): Promise<T> { return this.request<T>('POST', path, body); }
  put<T>(path: string, body: unknown): Promise<T> { return this.request<T>('PUT', path, body); }
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${k === 'expand' ? String(v) : encodeURIComponent(String(v))}`)
    .join('&');
  if (!q) return path;
  return path + (path.includes('?') ? '&' : '?') + q;
}

export function apiFromSecret(): BsaleApi {
  return new BsaleApi(BSALE_TOKEN.value());
}

// ---------- Formas crudas (parciales) de la API ----------
// Solo los campos que usamos; el resto queda en el JSON crudo del diagnóstico.

export interface RawRef { id: number | string; href?: string }

export interface RawOffice { id: number; name: string; address?: string; municipality?: string; city?: string; isVirtual?: number; state?: number; store?: number; defaultPriceList?: number }
export interface RawDocumentType { id: number; name: string; code?: string; codeSii?: string; isElectronicDocument?: number; state?: number; use?: number }
export interface RawPriceList { id: number | string; name: string; state?: number; coin?: RawRef }
export interface RawPriceDetail { id: number; variantValue: number; variantValueWithTaxes: number; variant: RawRef }
export interface RawProductType { id: number; name: string; state?: number }
export interface RawProduct { id: number; name: string; description?: string; state?: number; stockControl?: number; classification?: number; allowDecimal?: number; product_type?: RawRef & { name?: string } }
// allowDecimal lives on the product, not the variant (verified 19-10-2026).
export interface RawVariant { id: number; description?: string; code?: string; barCode?: string; state?: number; unlimitedStock?: number; allowDecimal?: number; product?: RawRef & { name?: string; allowDecimal?: number; state?: number } }
export interface RawStock { id: number; quantity: number; quantityReserved?: number; quantityAvailable?: number; variant: RawRef & { code?: string; description?: string }; office: RawRef }
export interface RawClient {
  id: number; firstName?: string; lastName?: string; email?: string; code?: string; phone?: string; createdAt?: number | string;
  company?: string; activity?: string; address?: string; city?: string; municipality?: string;
  companyOrPerson?: number; state?: number; updatedAt?: number;
}
export interface RawUser { id: number; firstName?: string; lastName?: string; email?: string; state?: number; office?: RawRef }
export interface RawDocumentDetail { id: number; quantity: number; netUnitValue?: number; totalUnitValue?: number; netAmount?: number; totalAmount?: number; note?: string; variant?: RawRef & { code?: string; description?: string } }
export interface RawDocument {
  id: number; number: number | string; emissionDate: number; generationDate?: number;
  totalAmount?: number; netAmount?: number; taxAmount?: number; state?: number; urlPdf?: string;
  document_type?: RawRef & { name?: string; codeSii?: string };
  office?: RawRef & { name?: string };
  client?: RawRef & { code?: string; company?: string; firstName?: string; lastName?: string };
  user?: RawRef & { firstName?: string; lastName?: string };
  sellers?: { items?: Array<RawRef & { firstName?: string; lastName?: string }> };
  details?: { items?: RawDocumentDetail[] };
  references?: { items?: Array<{ number?: string; reason?: string; referenceDate?: number }> };
}
