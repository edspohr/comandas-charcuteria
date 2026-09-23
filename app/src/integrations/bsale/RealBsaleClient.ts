import { httpsCallable } from 'firebase/functions';
import { functions } from '@/data/firebase';
import type { Order } from '@/domain/types';
import type {
  BsaleClient, BsaleCustomer, BsaleCustomerInput, BsaleDocument, BsaleVariantStock,
} from './BsaleClient';

// Cliente de la API real de Bsale. NO se despliega en la demo: se activa con
// `VITE_BSALE_MODE=real` cuando el token esté cargado en Secret Manager y la
// función `bsaleProxy` esté desplegada (ver README → "Activar Bsale real").
//
// Todos los requests van por el callable `bsaleProxy`: el browser no toca el
// token de Bsale ni conoce el endpoint. La forma de la respuesta se mapea al
// dominio que la app ya usa (BsaleClient), para que MockBsaleClient siga siendo
// intercambiable en la demo.

const proxy = httpsCallable<{ method: string; path: string; body?: unknown }, { status: number; data: any }>(functions, 'bsaleProxy');

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await proxy({ method, path, body });
  return res.data.data;
}

export class RealBsaleClient implements BsaleClient {
  async getStocks(officeId?: number): Promise<BsaleVariantStock[]> {
    const q = officeId ? `?officeid=${officeId}&expand=[variant]` : '?expand=[variant]';
    const raw = await call('GET', `/v1/stocks.json${q}`);
    // Bsale responde { items: [{ id, quantity, quantityAvailable, variant: { id, code, sku } }, …] }
    return (raw?.items ?? []).map((s: any): BsaleVariantStock => ({
      variantId: String(s.variant?.id ?? s.variantId ?? ''),
      sku: String(s.variant?.code ?? s.sku ?? ''),
      officeId: Number(s.office?.id ?? s.officeId ?? 1),
      quantity: Number(s.quantity ?? 0),
      quantityAvailable: Number(s.quantityAvailable ?? s.quantity ?? 0),
    }));
  }

  async getDocuments(params?: { sinceMs?: number; unlinkedOnly?: boolean; limit?: number }): Promise<BsaleDocument[]> {
    // Bsale usa `emissiondate` (segundos epoch). El flag `unlinkedOnly` no
    // existe en la API real: se calcula del lado del app comparando con
    // orders/*.invoiceRef.
    const parts: string[] = [];
    if (params?.sinceMs) parts.push(`emissiondate=${Math.floor(params.sinceMs / 1000)}:${Math.floor(Date.now() / 1000)}`);
    parts.push(`limit=${Math.min(params?.limit ?? 100, 250)}`);
    parts.push('expand=[document_type,client,details]');
    const raw = await call('GET', `/v1/documents.json?${parts.join('&')}`);
    return (raw?.items ?? []).map((d: any): BsaleDocument => ({
      id: String(d.id),
      type: mapDocType(d.document_type?.code ?? d.documentTypeCode ?? ''),
      number: `${prefixForType(d)}-${String(d.number).padStart(6, '0')}`,
      officeId: Number(d.office?.id ?? d.officeId ?? 1),
      emissionDate: new Date(Number(d.emissionDate ?? d.emission_date) * 1000).toISOString().slice(0, 10),
      emittedAt: Number(d.emissionDate ?? d.emission_date) * 1000,
      clientRut: d.client?.code,
      clientName: d.client?.company ?? d.client?.firstName ?? '',
      totalCLP: Number(d.totalAmount ?? 0),
      details: (d.details?.items ?? []).map((it: any) => ({
        variantId: String(it.variant?.id ?? ''),
        sku: String(it.variant?.code ?? ''),
        description: String(it.description ?? it.variant?.description ?? ''),
        quantity: Number(it.quantity ?? 0),
        netUnitValue: Number(it.netUnitValue ?? 0),
      })),
      reference: d.reference ?? undefined,
    }));
  }

  async getDocument(id: string): Promise<BsaleDocument | null> {
    try {
      const d = await call('GET', `/v1/documents/${id}.json?expand=[document_type,client,details]`);
      if (!d) return null;
      const list = await this.getDocuments({ limit: 1 });  // reuse mapping
      return list[0] ?? null;
    } catch { return null; }
  }

  async getClients(): Promise<BsaleCustomer[]> {
    // Paginación: Bsale limita a 25/50 por página; iteramos hasta agotar.
    const out: BsaleCustomer[] = [];
    let offset = 0; const step = 50;
    // Loop bounded: si algún día hay >10K clientes, adaptar a cursores.
    for (let i = 0; i < 200; i++) {
      const raw = await call('GET', `/v1/clients.json?limit=${step}&offset=${offset}`);
      const items = raw?.items ?? [];
      if (items.length === 0) break;
      for (const c of items) out.push(mapCustomer(c));
      if (items.length < step) break;
      offset += step;
    }
    return out;
  }

  async createClient(input: BsaleCustomerInput): Promise<BsaleCustomer> {
    const raw = await call('POST', '/v1/clients.json', {
      firstName: input.name,
      activity: input.fantasyName,
      code: input.rut,
      giro: input.giro,
      address: input.address,
      city: input.city,
      phone: input.phone,
      email: input.email,
    });
    return mapCustomer(raw);
  }

  async updateClient(id: string, patch: Partial<BsaleCustomerInput>): Promise<BsaleCustomer> {
    const raw = await call('PUT', `/v1/clients/${id}.json`, {
      firstName: patch.name,
      activity: patch.fantasyName,
      code: patch.rut,
      giro: patch.giro,
      address: patch.address,
      city: patch.city,
      phone: patch.phone,
      email: patch.email,
    });
    return mapCustomer(raw);
  }

  buildPayload(order: Order, invoiceRef?: string): unknown {
    // Misma forma que MockBsaleClient.buildPayload: la construcción del payload
    // no depende de si el cliente es real o mock — es contrato con Bsale.
    return {
      officeId: 1,
      documentTypeId: 1,  // factura
      reference: invoiceRef ?? order.id,
      client: { code: order.clientSnapshot.rut, company: order.clientSnapshot.name },
      details: order.lines.map((l) => ({
        variantCode: `${l.productId}__${l.formatId}`,
        description: `${l.productName} · ${l.formatLabel}`,
        quantity: l.packedQty ?? l.qty,
        netUnitValue: l.unitPriceSnapshotCLP ?? 0,
      })),
    };
  }
}

function mapCustomer(c: any): BsaleCustomer {
  return {
    id: String(c.id),
    rut: c.code ?? undefined,
    name: c.company ?? c.firstName ?? '',
    fantasyName: c.activity ?? undefined,
    giro: c.giro ?? undefined,
    address: c.address ?? undefined,
    city: c.city ?? undefined,
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
    updatedAt: c.updatedAt ? Number(c.updatedAt) * 1000 : undefined,
  };
}

function mapDocType(code: string): BsaleDocument['type'] {
  if (code.toLowerCase().includes('boleta')) return 'boleta';
  if (code.toLowerCase().includes('guia')) return 'guia';
  return 'factura';
}
function prefixForType(d: any): string {
  const c = String(d.document_type?.code ?? '').toLowerCase();
  if (c.includes('boleta')) return 'BO';
  if (c.includes('guia')) return 'GD';
  return 'FA';
}
