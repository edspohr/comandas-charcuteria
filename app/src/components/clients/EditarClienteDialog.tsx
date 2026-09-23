import { useState } from 'react';
import Button from '@/components/ui/Button';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { updateClientAdmin } from '@/data/clients';
import { demoUsers } from '@/data/demo-users';
import { describeFirestoreError } from '@/lib/errors';
import { isValidRut } from '@/lib/rut';
import type { Client, DeliveryMode } from '@/domain/types';

const VENDEDORES = demoUsers.filter((u) => u.role === 'vendedor');

// Administración corrige/completa la ficha. Datos de facturación → Bsale
// (maestro) y espejo; campos propios (modalidad, horario, notas, vendedor)
// solo al espejo.
export default function EditarClienteDialog({ client, uid, onClose }: { client: Client; uid: string; onClose: () => void }) {
  const [fantasyName, setFantasyName] = useState(client.fantasyName ?? '');
  const [name, setName] = useState(client.name);
  const [rut, setRut] = useState(client.rut ?? '');
  const [giro, setGiro] = useState(client.giro ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [phone, setPhone] = useState(client.contactPhone ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [hours, setHours] = useState(client.receivingHours ?? '');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(client.deliveryMode);
  const [notes, setNotes] = useState(client.notes ?? '');
  const [ownerUid, setOwnerUid] = useState(client.ownerUid ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rutOk = !rut.trim() || rut.trim() === (client.rut ?? '') || isValidRut(rut);
  const complete = !!(rut.trim() && rutOk && name.trim() && address.trim() && giro.trim());

  async function submit() {
    if (!rutOk) { setError('El RUT no es válido'); return; }
    setBusy(true); setError(null);
    try {
      await updateClientAdmin(client, { fantasyName, name, rut, giro, address, contactPhone: phone, email, receivingHours: hours, deliveryMode, notes, ownerUid }, uid);
      onClose();
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <ModalShell title="Editar cliente" eyebrow={client.bsaleClientId ? 'Se actualiza en Bsale' : 'Solo local'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <F label="Nombre comercial"><input value={fantasyName} onChange={(e) => setFantasyName(e.target.value)} className="field h-10 text-sm" /></F>
          <F label="Razón social *"><input value={name} onChange={(e) => setName(e.target.value)} className="field h-10 text-sm" /></F>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="RUT"><input value={rut} onChange={(e) => setRut(e.target.value)} className={'field h-10 text-sm ' + (!rutOk ? 'border-red-400' : '')} /></F>
          <F label="Giro"><input value={giro} onChange={(e) => setGiro(e.target.value)} className="field h-10 text-sm" /></F>
        </div>
        <F label="Dirección"><input value={address} onChange={(e) => setAddress(e.target.value)} className="field h-10 text-sm" /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Teléfono"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="field h-10 text-sm" /></F>
          <F label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className="field h-10 text-sm" /></F>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Horario de recepción"><input value={hours} onChange={(e) => setHours(e.target.value)} className="field h-10 text-sm" /></F>
          <F label="Modalidad">
            <div className="flex gap-1">
              {(['despacho', 'retiro'] as DeliveryMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setDeliveryMode(m)} className={'flex-1 h-10 rounded-md border text-xs uppercase tracking-display ' + (deliveryMode === m ? 'bg-charcoal-900 text-cream-50 border-charcoal-900' : 'bg-white border-charcoal-200 text-charcoal-500')}>{m}</button>
              ))}
            </div>
          </F>
        </div>
        <F label="Vendedor responsable">
          <select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} className="field h-10 text-sm">
            <option value="">— Sin asignar —</option>
            {VENDEDORES.map((v) => <option key={v.uid} value={v.uid}>{v.displayName}</option>)}
          </select>
        </F>
        <F label="Notas"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="field h-auto py-2 text-sm resize-none" /></F>
        <div className={'rounded-md p-2.5 text-xs border ' + (complete ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-brass-50 border-brass-300 text-brass-700')}>
          {complete ? 'Datos de facturación completos: el cliente deja de estar pendiente de revisión.' : 'Faltan datos para facturar (RUT, razón social, giro y dirección).'}
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" disabled={busy}>Cancelar</Button>
          <Button onClick={submit} className="flex-1" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="eyebrow block mb-1">{label}</label>{children}</div>;
}
