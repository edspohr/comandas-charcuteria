import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { OpportunityAlerts } from '@/domain/opportunities';
import { todayInSantiago } from '@/lib/format';

// Recordatorio al entrar a la app: el ejecutivo ve de inmediato si tiene
// oportunidades nuevas, vencidas o que vencen hoy o mañana. Se puede cerrar
// por el día (queda solo el globo del menú).

const key = (uid: string) => `comandas:oppReminder:${uid}`;

function dismissedToday(uid: string): boolean {
  try { return localStorage.getItem(key(uid)) === todayInSantiago(); } catch { return false; }
}

export default function OpportunityReminder({ uid, alerts, hidden }: { uid: string; alerts: OpportunityAlerts; hidden: boolean }) {
  const [closed, setClosed] = useState(() => dismissedToday(uid));
  const parts = [
    alerts.nuevas > 0 && `${alerts.nuevas} nueva${alerts.nuevas === 1 ? '' : 's'} sin gestionar`,
    alerts.vencidas > 0 && `${alerts.vencidas} vencida${alerts.vencidas === 1 ? '' : 's'}`,
    alerts.hoy > 0 && `${alerts.hoy} para hoy`,
    alerts.manana > 0 && `${alerts.manana} vence${alerts.manana === 1 ? '' : 'n'} mañana`,
  ].filter(Boolean) as string[];
  if (hidden || closed || parts.length === 0) return null;
  const urgent = alerts.vencidas > 0 || alerts.hoy > 0;

  function close() {
    try { localStorage.setItem(key(uid), todayInSantiago()); } catch { /* sin almacenamiento: se cierra solo por ahora */ }
    setClosed(true);
  }

  return (
    <div role="status" className={'card mb-4 p-3 flex items-start gap-3 ' + (urgent ? 'border-red-200 bg-red-50' : 'border-brass-300 bg-brass-50')}>
      <div className="min-w-0 flex-1">
        <p className={'text-sm font-semibold ' + (urgent ? 'text-red-800' : 'text-charcoal-900')}>Tiene oportunidades pendientes</p>
        <p className="text-xs text-charcoal-700 mt-0.5">{parts.join(' · ')}</p>
      </div>
      <Link to="/oportunidades" className="shrink-0 rounded-md bg-charcoal-900 text-cream-50 text-xs font-semibold px-3 py-2">Ver</Link>
      <button onClick={close} aria-label="Cerrar el recordatorio por hoy" className="shrink-0 text-charcoal-400 hover:text-charcoal-700 text-lg leading-none px-1">×</button>
    </div>
  );
}
