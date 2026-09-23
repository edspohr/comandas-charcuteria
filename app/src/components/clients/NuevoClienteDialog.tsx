import { useState } from 'react';
import Button from '@/components/ui/Button';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { createClientQuick } from '@/data/clients';
import { describeFirestoreError } from '@/lib/errors';
import { isValidRut } from '@/lib/rut';
import type { Client, DeliveryMode } from '@/domain/types';
import type { ClientHints } from '@/domain/parse/client';

// Alta rápida de cliente para el vendedor: lo mínimo para poder tomar el
// pedido hoy. Lo que falte para facturar lo completa administración
// (el cliente queda marcado "pendiente de revisión").
export default function NuevoClienteDialog({ initial, uid, onClose, onCreated }: {
  initial?: ClientHints;
  uid: string;
  onClose: () => void;
  onCreated: (c: Client) => void;
}) {
  const [fantasyName, setFantasyName] = useState(initial?.fantasyName ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [rut, setRut] = useState(initial?.rut ?? '');
  const [giro, setGiro] = useState('');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [hours, setHours] = useState(initial?.receivingHours ?? '');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(initial?.deliveryMode ?? 'despacho');
  const [notes, setNotes] = useState(initial?.contactName ? `Contacto: ${initial.contactName}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rutOk = !rut.trim() || isValidRut(rut);
  const complete = !!(rut.trim() && rutOk && (name.trim() || fantasyName.trim()) && address.trim() && giro.trim());

  async function submit() {
    if (fantasyName.trim().length < 2) { setError('Indique el nombre del cliente'); return; }
    if (!rutOk) { setError('El RUT no es válido'); return; }
    setBusy(true); setError(null);
    try {
      const c = await createClientQuick({ fantasyName, name, rut, giro, address, contactPhone: phone, email, receivingHours: hours, deliveryMode, notes }, uid);
      onCreated(c);
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <ModalShell title="Nuevo cliente" eyebrow="Alta rápida" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nombre del local / cliente *"><input value={fantasyName} onChange={(e) => setFantasyName(e.target.value)} autoFocus placeholder="Ej: Café Oven" className="field h-10 text-sm" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="RUT"><input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76.888.111-2" className={'field h-10 text-sm ' + (!rutOk ? 'border-red-400' : '')} /></Field>
          <Field label="Teléfono"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 …" className="field h-10 text-sm" /></Field>
        </div>
        <Field label="Razón social (para facturar)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Si difiere del nombre" className="field h-10 text-sm" /></Field>
        <Field label="Giro"><input value={giro} onChange={(e) => setGiro(e.target.value)} placeholder="Restaurante, hotelería, minimarket…" className="field h-10 text-sm" /></Field>
        <Field label="Dirección de entrega"><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle 123, Comuna" className="field h-10 text-sm" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Horario de recepción"><input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="L-V 9:00-14:00" className="field h-10 text-sm" /></Field>
          <Field label="Modalidad">
            <div className="flex gap-1">
              <button type="button" onClick={() => setDeliveryMode('despacho')} className={'flex-1 h-10 rounded-md border text-xs uppercase tracking-display ' + (deliveryMode === 'despacho' ? 'bg-charcoal-900 text-cream-50 border-charcoal-900' : 'bg-white border-charcoal-200 text-charcoal-500')}>Despacho</button>
              <button type="button" onClick={() => setDeliveryMode('retiro')} className={'flex-1 h-10 rounded-md border text-xs uppercase tracking-display ' + (deliveryMode === 'retiro' ? 'bg-charcoal-900 text-cream-50 border-charcoal-900' : 'bg-white border-charcoal-200 text-charcoal-500')}>Retiro</button>
            </div>
          </Field>
        </div>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className="field h-10 text-sm" /></Field>
        <Field label="Notas"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contacto, referencias…" className="field h-10 text-sm" /></Field>

        <div className={'rounded-md p-2.5 text-xs border ' + (complete ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-brass-50 border-brass-300 text-brass-700')}>
          {complete ? 'Datos de facturación completos.' : 'Se creará con facturación incompleta: podés tomar el pedido igual; administración completa RUT, razón social, giro y dirección después.'}
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" disabled={busy}>Cancelar</Button>
          <Button onClick={submit} className="flex-1" disabled={busy || fantasyName.trim().length < 2}>{busy ? 'Creando…' : 'Crear cliente'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="eyebrow block mb-1">{label}</label>
      {children}
    </div>
  );
}
