import type { Semaphore } from '@/data/stock';

const STYLE: Record<Semaphore, string> = {
  ok:      'bg-emerald-50 text-emerald-800 border border-emerald-200',
  partial: 'bg-brass-50 text-brass-700 border border-brass-300',
  none:    'bg-red-50 text-red-800 border border-red-200',
};

const LABEL: Record<Semaphore, string> = {
  ok: 'Stock OK',
  partial: 'Stock parcial',
  none: 'Sin stock',
};

export default function SemaphoreBadge({ level, note }: { level: Semaphore; note?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STYLE[level]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {note ?? LABEL[level]}
    </span>
  );
}
