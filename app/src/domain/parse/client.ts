import type { Client, DeliveryMode } from '@/domain/types';
import { cleanRut, formatRut, isValidRut } from '@/lib/rut';

// Datos de cliente que se pueden rescatar de un mensaje de WhatsApp. Todo es
// opcional: lo que no aparece lo completa el vendedor en el formulario.
export interface ClientHints {
  fantasyName?: string;
  name?: string;        // razón social
  rut?: string;
  phone?: string;
  email?: string;
  address?: string;
  receivingHours?: string;
  deliveryMode?: DeliveryMode;
  contactName?: string;
}

const RUT_RE = /\b(\d{1,2}\.?\d{3}\.?\d{3})\s?-\s?([\dkK])\b/;
const PHONE_RE = /(\+?56\s?)?(9\s?\d{4}\s?\d{4})\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const ADDRESS_LINE_RE = /\b(direcci[oó]n|entregar en|despachar a|enviar a|dejar en|calle|av\.?|avenida|pasaje|local)\b/i;
const ADDRESS_SHAPE_RE = /\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ.]+(?:\s+(?:de|del|la|las|los|el|y|[A-ZÁÉÍÓÚÑ][\wáéíóúñ.]+)){0,5})\s+(\d{2,5})(?:\s*,?\s*(?:local|of\.?|oficina|depto\.?|dpto\.?)\s*[\w-]+)?(?:\s*,\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñ ]{2,30}))?/;
// Name tokens are case-sensitive on purpose: a business name is Capitalised,
// the verb that follows ("necesita", "quiere") is not, so it ends the match.
const TOKEN = "[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ&'-]*";
const NAME_SEQ = `${TOKEN}(?:\s+(?:de|del|la|las|los|el|y)\s+)?(?:\s*${TOKEN}){0,3}`;
const BUSINESS_KW = /\b(hotel|restaurante?|restaurant|caf[eé]|cafeter[ií]a|panader[ií]a|pasteler[ií]a|tienda|bar|pizzer[ií]a|emporio|almac[eé]n|deli|delicatessen|bodega|club|casino|hostal|fuente de soda|minimarket|supermercado)\b/i;
const BUSINESS_NAME_RE = new RegExp(`^\\s+(${NAME_SEQ})`);
const SOY_RE = new RegExp(`\\b(?:soy|habla|le escribe|te escribe|de parte de)\\s+(${TOKEN}(?:\\s+${TOKEN})?)\\s+(?:de|del)\\s+(?:la\\s+|el\\s+)?((?:${BUSINESS_KW.source.slice(2, -2)})?\\s*${NAME_SEQ})`, 'i');
const HOURS_RE = /\b(?:horario|recepci[oó]n|recibimos|atendemos)\b[^\n]*?(\d{1,2}(?::\d{2})?\s*(?:a|-|hasta)\s*\d{1,2}(?::\d{2})?\s*(?:h|hrs)?)/i;
const RAZON_RE = /\b(?:raz[oó]n social|facturar a|a nombre de)\s*[:\-]?\s*([^\n,]{3,60})/i;

export function extractClientHints(text: string): ClientHints {
  const h: ClientHints = {};
  const rut = text.match(RUT_RE);
  if (rut) {
    const raw = `${rut[1]}-${rut[2]}`;
    if (isValidRut(raw)) h.rut = formatRut(cleanRut(raw));
  }
  const phone = text.match(PHONE_RE);
  if (phone) h.phone = `+56 ${phone[2].replace(/\s/g, '').replace(/^(9)(\d{4})(\d{4})$/, '$1 $2 $3')}`;
  const email = text.match(EMAIL_RE);
  if (email) h.email = email[0].toLowerCase();

  const razon = text.match(RAZON_RE);
  if (razon) h.name = razon[1].trim();

  const soy = text.match(SOY_RE);
  if (soy) { h.contactName = soy[1].trim(); h.fantasyName = tidyName(soy[2]); }
  if (!h.fantasyName) {
    const kw = text.match(BUSINESS_KW);
    if (kw && kw.index != null) {
      const after = text.slice(kw.index + kw[0].length).match(BUSINESS_NAME_RE);
      if (after) h.fantasyName = tidyName(`${kw[0]} ${after[1]}`);
    }
  }

  // Address: prefer a line that announces it, else the first "Calle 1234, Comuna" shape.
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const addrLine = lines.find((l) => ADDRESS_LINE_RE.test(l) && /\d{2,5}/.test(l));
  const addrSrc = addrLine ?? text;
  const addr = addrSrc.replace(/^[^:]*(direcci[oó]n|entregar en|despachar a|enviar a|dejar en)\s*[:\-]?\s*/i, '').match(ADDRESS_SHAPE_RE);
  if (addr) h.address = addr[0].replace(/\s+/g, ' ').trim();

  const hours = text.match(HOURS_RE);
  if (hours) h.receivingHours = hours[1].replace(/\s+/g, ' ');

  if (/\b(retir|pasamos a buscar|lo buscamos|vamos a buscar)/i.test(text)) h.deliveryMode = 'retiro';
  else if (/\b(despach|enviar|env[ií]o|entregar en|dejar en)/i.test(text)) h.deliveryMode = 'despacho';
  return h;
}

function tidyName(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Nombre comparable: sin tildes, signos ni la forma societaria («ANDAR CAFE
// SPA» = «Andar Café»).
const LEGAL = /\b(spa|s a|sa|ltda|limitada|eirl|e i r l|sociedad|cia|y cia)\b/g;
export const baseName = (s: string | undefined | null) =>
  norm(s ?? '').replace(/[^a-z0-9ñ]+/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();

function nameScore(n: string, f: string): number {
  if (!n || !f) return 0;
  if (f === n) return 80;
  if (f.length >= 4 && (f.startsWith(n + ' ') || n.startsWith(f + ' '))) return 60;
  if (` ${f} `.includes(` ${n} `) || (f.length >= 5 && ` ${n} `.includes(` ${f} `))) return 45;
  const nw = n.split(' ').filter((w) => w.length > 2);
  const fw = new Set(f.split(' ').filter((w) => w.length > 2));
  if (!nw.length) return 0;
  const hit = nw.filter((w) => fw.has(w)).length / nw.length;
  return hit >= 0.6 ? Math.round(30 * hit) : 0;
}

export interface RankedClient { client: Client; score: number }

// Todos los clientes que podrían ser el del mensaje, del más probable al
// menos: RUT, teléfono y nombre (fantasía o razón social, sin forma
// societaria). Con datos incompletos también cuentan: se elige y se piden
// los datos que faltan (caso Andar Café, 06-11).
export function rankClients(hints: ClientHints, clients: Client[], max = 5): RankedClient[] {
  const rut = hints.rut ? cleanRut(hints.rut) : '';
  const digits = hints.phone ? hints.phone.replace(/\D/g, '').slice(-8) : '';
  const names = [hints.fantasyName, hints.name].map(baseName).filter(Boolean);
  const out: RankedClient[] = [];
  for (const c of clients) {
    let score = 0;
    if (rut && c.rut && cleanRut(c.rut) === rut) score = 100;
    else if (digits.length >= 8 && c.contactPhone && c.contactPhone.replace(/\D/g, '').endsWith(digits)) score = 90;
    else {
      const fields = [baseName(c.fantasyName), baseName(c.name)];
      for (const n of names) for (const f of fields) score = Math.max(score, nameScore(n, f));
    }
    if (score > 0) out.push({ client: c, score: score + (c.rut ? 3 : 0) + (c.bsaleClientId ? 2 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

export const CONFIDENT_MATCH = 45;

// El más probable, si es lo bastante seguro.
export function matchExistingClient(hints: ClientHints, clients: Client[]): Client | null {
  const best = rankClients(hints, clients, 1)[0];
  return best && best.score >= CONFIDENT_MATCH ? best.client : null;
}

// Datos que faltan para facturar.
export function missingBillingData(c: Pick<Client, 'rut' | 'giro' | 'address' | 'name'>): string[] {
  return [!c.rut && 'RUT', !c.name && 'razón social', !c.giro && 'giro', !c.address && 'dirección'].filter(Boolean) as string[];
}

// Segunda línea para reconocer al cliente: la razón social cuando difiere del
// nombre de fantasía (en Bsale a veces la fantasía es el contacto: «DAYANA
// SILVA» es ANDAR CAFE SPA).
export function clientAltName(c: Pick<Client, 'name' | 'fantasyName'>): string | null {
  return c.fantasyName && baseName(c.fantasyName) !== baseName(c.name) ? c.name : null;
}

export function hintsHaveSomething(h: ClientHints): boolean {
  return !!(h.fantasyName || h.name || h.rut || h.phone || h.address || h.email);
}

// Lines that carry client data, not products — the local parser should skip
// them instead of proposing "Salame Italiano" for "Av. Italia 1450".
export function isClientInfoLine(raw: string): boolean {
  return RUT_RE.test(raw) || PHONE_RE.test(raw) || EMAIL_RE.test(raw)
    || /\b(direcci[oó]n|fono|tel[eé]fono|celular|whatsapp|rut|raz[oó]n social|horario|recibimos|atendemos|gracias|saludos)\b/i.test(raw);
}
