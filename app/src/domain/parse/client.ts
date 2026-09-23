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

// Try to recognise an existing client from the hints: RUT wins, then phone,
// then a loose name match on fantasyName / razón social.
export function matchExistingClient(hints: ClientHints, clients: Client[]): Client | null {
  if (hints.rut) {
    const c = clients.find((x) => x.rut && cleanRut(x.rut) === cleanRut(hints.rut!));
    if (c) return c;
  }
  if (hints.phone) {
    const digits = hints.phone.replace(/\D/g, '').slice(-8);
    const c = clients.find((x) => x.contactPhone && x.contactPhone.replace(/\D/g, '').endsWith(digits));
    if (c) return c;
  }
  const candidates = [hints.fantasyName, hints.name].filter(Boolean).map((s) => norm(s!));
  for (const n of candidates) {
    const c = clients.find((x) => norm(x.fantasyName ?? '') === n || norm(x.name) === n || norm(x.name).includes(n) || (x.fantasyName ? n.includes(norm(x.fantasyName)) : false));
    if (c) return c;
  }
  return null;
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
