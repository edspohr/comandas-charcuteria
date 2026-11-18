import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/data/firebase';
import { useUsers } from '@/data/users';
import { callableMessage } from '@/data/userAdmin';
import Button from '@/components/ui/Button';
import type { Client } from '@/domain/types';

const assign = httpsCallable<{ clientId: string; ownerUid: string }, { ok: true }>(functions, 'adminAssignClientOwner');
export default function AsignarCartera({ client }: { client: Client }) {
  const { users, nameOf } = useUsers();
  const [owner, setOwner] = useState(client.ownerUid ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const eligible = users.filter(u => u.active !== false && !u.placeholder && !u.mergedInto);
  async function save() {
    setBusy(true); setMessage('');
    try { await assign({ clientId: client.id, ownerUid: owner }); setMessage('Asignación guardada.'); }
    catch (e) { setMessage(callableMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="card p-4 mb-4">
    <label htmlFor="client-owner" className="eyebrow block mb-2">Vendedor responsable</label>
    <div className="flex gap-2 flex-wrap">
      <select id="client-owner" className="field flex-1 min-w-0" value={owner} onChange={e => { setOwner(e.target.value); setMessage(''); }} disabled={busy}>
        <option value="">Sin asignar</option>
        {client.ownerUid && !eligible.some(u => u.uid === client.ownerUid) && <option value={client.ownerUid}>{nameOf(client.ownerUid)} (cuenta no habilitada)</option>}
        {eligible.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
      </select>
      <Button size="sm" disabled={busy || owner === (client.ownerUid ?? '')} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar asignación'}</Button>
    </div>
    <p className="text-xs text-charcoal-500 mt-2">La asignación se guarda en Comandas y se conserva al sincronizar Bsale.</p>
    {client.ownerAssignmentSource === 'bsale' && <p className="text-xs text-charcoal-500 mt-1">Asignación sugerida por el historial de ventas de Bsale.</p>}
    {message && <p role="status" className="text-sm mt-2">{message}</p>}
  </section>;
}
