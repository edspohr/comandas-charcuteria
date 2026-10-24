import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { ROUTE_ACCESS } from '@/domain/permissions';
import { Icon } from '@/components/ui/Icon';

// Dos formas de crear un pedido, una sola entrada en el menú.
export default function NewOrderTabs({ active }: { active: 'manual' | 'ia' }) {
  const { current } = useCurrentUser();
  if (!current || !ROUTE_ACCESS.pedidoIA(current.appUser.role)) return null;
  const base = 'flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs uppercase tracking-display font-medium transition';
  return (
    <div className="mb-5 flex rounded-md border border-charcoal-200 bg-white overflow-hidden" role="tablist" aria-label="Cómo crear el pedido">
      <Link to="/vendedor/nuevo" role="tab" aria-selected={active === 'manual'} className={base + (active === 'manual' ? ' bg-charcoal-900 text-cream-50' : ' text-charcoal-500 hover:bg-cream-100')}>
        <Icon name="pencil" size={15} /> Paso a paso
      </Link>
      <Link to="/vendedor/pegar" role="tab" aria-selected={active === 'ia'} className={base + (active === 'ia' ? ' bg-charcoal-900 text-cream-50' : ' text-charcoal-500 hover:bg-cream-100')}>
        <Icon name="sparkle" size={15} /> Pegar mensaje (IA)
      </Link>
    </div>
  );
}
