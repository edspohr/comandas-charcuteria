import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/types';

// Muted palette that survives on cream backgrounds.
const STYLE: Record<OrderStatus, string> = {
  recibido:           'bg-charcoal-100 text-charcoal-500 border-charcoal-200',
  confirmado:         'bg-emerald-50 text-emerald-800 border-emerald-200',
  confirmado_parcial: 'bg-brass-50 text-brass-700 border-brass-300',
  en_armado:          'bg-blue-50 text-blue-800 border-blue-200',
  armado:             'bg-indigo-50 text-indigo-800 border-indigo-200',
  facturado:          'bg-violet-50 text-violet-800 border-violet-200',
  despachado:         'bg-sky-50 text-sky-800 border-sky-200',
  entregado:          'bg-charcoal-700 text-cream-50 border-charcoal-700',
  anulado:            'bg-red-50 text-red-800 border-red-200',
};

export default function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-display font-semibold ${STYLE[status]}`}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}
