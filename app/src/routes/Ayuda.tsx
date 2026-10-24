import { useState } from 'react';
import { useCurrentUser } from '@/data/auth';
import { ROLE_LABEL } from '@/domain/permissions';
import type { Role } from '@/domain/types';
import Button from '@/components/ui/Button';

// Guía de una página por perfil (versión 1.0). Cada persona ve la suya;
// super administración ve todas para imprimirlas o compartirlas.

interface Guide { title: string; sections: Array<[string, string[]]> }

const ACCESS: [string, string[]] = ['Entrar y su PIN', [
  'La primera vez entre con «Continuar con Google» (o con el correo de contraseña que le llegó). La app le pide crear su PIN de 4 dígitos y aceptar que lo que se haga con su cuenta y su PIN es su responsabilidad.',
  'Desde ahí entra con su correo y su PIN. En un teléfono compartido toque su nombre en «En este dispositivo».',
  'La app se bloquea al abrirla y tras 30 minutos sin uso: desbloquee con su PIN. «Bloquear ahora» y «Cerrar sesión» están bajo su nombre (arriba a la derecha en el teléfono).',
  'Si olvida el PIN o se bloquea, pídale a Ciro o a Edmundo que lo borre en Usuarios y cree uno nuevo al entrar con Google.',
  'Instale la app en el teléfono con el botón «Instalar app» (menú de su nombre o «Más»). En iPhone: Safari → Compartir → «Agregar a inicio».',
]];

const GUIDES: Record<Role, Guide> = {
  vendedor: { title: 'Ventas', sections: [
    ACCESS,
    ['Tomar un pedido', [
      'Toque el botón «＋» (abajo al centro). Elija «Paso a paso» o «Pegar mensaje (IA)» si el cliente le escribió por WhatsApp.',
      'Cliente → productos → entrega → confirmar. El stock que ve es el real de Bsale; si falta, el pedido igual se envía y despacho decide.',
      'Horario de entrega obligatorio: desde y hasta qué hora recibe el cliente. Queda como habitual en su ficha. El nombre de fantasía es opcional.',
      'Muestras: en Productos toque «+ Muestra» (80 g por defecto, sin cargo).',
      'Condición especial (precio, corte, pago o entrega fuera de lo normal): márquela en Confirmar con una nota. El pedido queda «por aprobar» hasta que Ciro lo aprueba: no lo confirme al cliente antes.',
    ]],
    ['Seguir sus pedidos', [
      '«Pedidos» muestra solo los suyos, por etapa: Pendiente → En armado → Por facturar → Por despachar → Cerrado. Rojo = atrasado o con problema.',
      'Puede anular un pedido suyo mientras no esté facturado (pide su PIN).',
      'Siete días después de entregar una muestra aparece «¿Qué le pareció…?»: responda en un toque.',
    ]],
    ['Clientes', ['«Clientes» → «Mi cartera»: quién está en riesgo o dejó de comprar. Toque un cliente para ver su historial y lo que compra.']],
  ] },
  tienda: { title: 'Tienda', sections: [
    ACCESS,
    ['Reposición', ['Toque «＋» para pedir reposición a la fábrica. Cuando llegue, en «Pedidos» toque «Recibir en tienda».']],
    ['Ventas a clientes', ['Igual que ventas: «＋», cliente, productos, horario de entrega y confirmar.']],
  ] },
  despacho: { title: 'Despacho y armado', sections: [
    ACCESS,
    ['Armar', [
      '«Pedidos» ordena cada columna por fecha y hora de entrega. Toque «Tomar» y luego «Armar».',
      'Registre lo que realmente empacó (peso real en granel y piezas). Si algo faltó, márquelo con el motivo.',
      'Si una línea dice «Sin stock en Bsale», arme con lo que haya en cámara y registre lo empacado.',
      'Las muestras vienen marcadas «MUESTRA»: rotúlelas con el nombre del cliente.',
      'Un pedido «por aprobar» todavía no se arma.',
    ]],
    ['Despachar', ['Cuando el pedido tiene su documento aparece «Despachar». Un pedido solo de muestras se cierra con «Registrar salida».']],
  ] },
  reparto: { title: 'Reparto', sections: [
    ACCESS,
    ['Entregar', ['En «Pedidos», columna Por despachar / Cerrado: toque «Entregar» y anote quién recibió. Fíjese en el horario de recepción de cada cliente.']],
  ] },
  produccion: { title: 'Producción', sections: [
    ACCESS,
    ['Qué producir', ['«Producción» → «Demanda y stock»: lo que piden los pedidos contra el stock de Bsale. Lo marcado «a producir» va primero.']],
    ['Registrar lo producido', [
      '«Foto o texto (IA)»: toque «Fotografiar planilla», revise las líneas que propone la IA y confirme. También puede pegar el reporte como texto.',
      '«Registrar a mano» si prefiere tipear producto y cantidad.',
    ]],
  ] },
  admin: { title: 'Administración', sections: [
    ACCESS,
    ['Facturar', ['En «Pedidos», columna Por facturar: emita en el POS de Bsale con los pesos del armado y toque «Facturar» para vincular el documento (pide PIN). La reserva de stock se libera sola.']],
    ['Todo lo demás', ['Puede tomar pedidos, armar, despachar, ver el Panel y el Catálogo como los perfiles de operación.']],
  ] },
  superAdmin: { title: 'Super administración', sections: [
    ACCESS,
    ['Aprobar excepciones', ['Arriba del Tablero aparece «Pedidos por aprobar». Revise y apruebe o rechace con su PIN (rechazar anula el pedido con el motivo).']],
    ['Personas', ['«Usuarios» → «+ Agregar persona» o «Invitar con su historial» (trae los pedidos y la cartera de WhatsApp). Cada persona crea su PIN al entrar. Aquí se desactiva a alguien o se borra su PIN.']],
    ['Gestión', ['«Panel de gestión»: ventas de Bsale, margen, clientes, vendedores, stock y muestras (incluye kg de muestra por cliente nuevo). «Catálogo»: qué productos se ofrecen en pedidos.']],
    ['Facturar después de entregar', ['Desde «Facturar» puede «Despachar sin factura»; al entregarse aparece «Facturar» en Cerrado.']],
  ] },
  consultor: { title: 'Consulta', sections: [
    ACCESS,
    ['Qué puede ver', ['Todo en modo lectura: Panel de gestión, Ventana a Bsale, Pedidos, Clientes, Catálogo y Usuarios. No puede modificar nada.']],
  ] },
};

const ORDER: Role[] = ['vendedor', 'tienda', 'despacho', 'reparto', 'produccion', 'admin', 'superAdmin', 'consultor'];

export default function Ayuda() {
  const { current } = useCurrentUser();
  const role = current!.appUser.role;
  const all = role === 'superAdmin';
  const [shown, setShown] = useState<Role>(role);
  const g = GUIDES[shown];
  return (
    <div className="max-w-2xl">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Guía de uso</h1>
          <p className="text-xs text-charcoal-300 mt-1">Comandas 1.0 · perfil {ROLE_LABEL[shown]}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => window.print()} className="print:hidden">Imprimir</Button>
      </header>
      {all && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto print:hidden">
          {ORDER.map((r) => (
            <button key={r} onClick={() => setShown(r)} className={'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display border ' + (shown === r ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {g.sections.map(([title, items]) => (
          <section key={title} className="card p-4 break-inside-avoid">
            <p className="eyebrow mb-2">{title}</p>
            <ul className="space-y-2 text-sm text-charcoal-800 list-disc pl-5">
              {items.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </section>
        ))}
        <section className="card p-4">
          <p className="eyebrow mb-2">¿Algo no funciona?</p>
          <p className="text-sm text-charcoal-800">Avise en el grupo de soporte con una captura de pantalla. Mientras se resuelve, el grupo de WhatsApp de ventas sigue disponible como respaldo.</p>
        </section>
      </div>
    </div>
  );
}
