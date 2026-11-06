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
  'Instale la app en el teléfono con el botón «Instalar app» (menú de su nombre o «Más»). En iPhone: Safari → ••• (abajo a la derecha) → Compartir → «Agregar a inicio».',
]];

const GUIDES: Record<Role, Guide> = {
  vendedor: { title: 'Ventas', sections: [
    ACCESS,
    ['Tomar un pedido', [
      'Toque el botón «＋» (abajo al centro). Elija «Paso a paso» o «Pegar mensaje (IA)» si el cliente le escribió por WhatsApp.',
      'Cliente → productos → entrega → confirmar. El stock que ve es el real de Bsale; si falta, el pedido igual se envía y despacho decide.',
      'Horario de entrega obligatorio, pero flexible: basta con una hora, un rango o una nota («en la mañana»). Un rango completo queda como habitual en su ficha. El nombre de fantasía es opcional.',
      'Al enviar el pedido se pide su PIN: el pedido queda a su nombre.',
      'Muestras: en Productos toque «+ Muestra» (80 g por defecto, sin cargo).',
      'Muestras para prospectar, sin cliente: en el paso Cliente toque «Muestras a mi nombre». Salen del stock y quedan a su cargo; después las cruza con sus clientes.',
      'Condición especial (precio, corte, pago o entrega fuera de lo normal): márquela en Confirmar con una nota. El pedido queda «por aprobar» hasta que Ciro lo aprueba: no lo confirme al cliente antes.',
    ]],
    ['Seguir sus pedidos', [
      '«Pedidos» muestra solo los suyos, por etapa: Pendiente → En armado → Por facturar → Por despachar → Cerrado. Rojo = atrasado o con problema.',
      'Si el cliente pide más o menos, abra el pedido y toque «Modificar pedido» (hasta que se facture, con PIN): cambie cantidades, quite o agregue productos. El stock se reajusta solo y armado ve la tarjeta en naranja con el cambio.',
      'Si armado tuvo que rebajar algo (faltó o vino menos), su pedido aparece en naranja con lo que bajó en rojo: avísele al cliente y toque «Visto».',
      'Puede anular un pedido suyo mientras no esté armado, o «Eliminar pedido» (duplicado, prueba, cancelado) hasta que se facture: desaparece de la app y libera el stock. Ambos piden su PIN.',
      'Siete días después de entregar una muestra aparece «¿Qué le pareció…?»: responda en un toque.',
    ]],
    ['Oportunidades', [
      'El globo rojo en «Oportunidades» cuenta lo que tiene que atender ya: nuevas sin gestionar, vencidas y las de hoy. Al entrar, un aviso le recuerda también las que vencen mañana.',
      '«Oportunidades» → «Agenda»: lo que toca hoy o está atrasado (franja roja). Ahí aparecen las visitas que le asigna Ciro y las suyas.',
      'Abra una oportunidad y toque «Registrar visita o llamada»: anote qué pasó y el siguiente paso con fecha.',
      '«Muestras o pedido» abre Nuevo pedido con el cliente listo y ligado a la oportunidad. Las muestras se agregan con «+ Muestra».',
      'Si el cliente pide esperar, «Postergar» con la fecha en que vuelve a su agenda. Si no resultó, «Perdida» con el motivo.',
      'Se gana sola cuando el pedido se factura. Para crear una propia: «+ Oportunidad».',
    ]],
    ['Clientes', ['«Clientes» → «Mi cartera»: quién está en riesgo o dejó de comprar. Toque un cliente para ver su historial y lo que compra.']],
  ] },
  tienda: { title: 'Tienda', sections: [
    ACCESS,
    ['Pedir reposición', [
      'Toque «＋»: la tienda ya viene elegida. Agregue productos y cantidades, indique el día y confirme con su PIN.',
      'Despacho lo arma y registra el traslado. Cuando llegue, en «Pedidos» toque «Recibir en tienda» y revise lo recibido.',
    ]],
    ['Seguir sus pedidos', ['«Pedidos» muestra los pedidos de la tienda por etapa. Rojo = atrasado o con problema.']],
    ['Oportunidades', ['Igual que un vendedor: «Oportunidades» → «Agenda», registre visitas y llamadas, y cree muestras o pedidos desde la oportunidad.']],
  ] },
  despacho: { title: 'Despacho y armado', sections: [
    ACCESS,
    ['Armar', [
      '«Pedidos» ordena cada columna por fecha y hora de entrega. Toque «Tomar» y luego «Armar».',
      'Tome varios pedidos y toque «Total en armado»: suma los productos de los pedidos que tomó para ir a buscar todo de una vez. Marque lo que ya sacó.',
      'Comandas impresas: en «Total en armado» toque «Imprimir comandas» (una por pedido, en orden de entrega) o, dentro del pedido, «Imprimir comanda». Péguela en el paquete. En «Impresora» se elige RawBT (tablet Android con la térmica) o el diálogo del navegador, y si se imprime apenas toma un pedido.',
      'Registre lo que realmente empacó (peso real en granel y piezas). Si algo faltó, márquelo con el motivo.',
      'Si una línea dice «Sin stock en Bsale», arme con lo que haya en cámara y registre lo empacado.',
      'Las muestras vienen marcadas «MUESTRA»: rotúlelas con el nombre del cliente.',
      'Un pedido «por aprobar» todavía no se arma.',
      'Tarjeta en naranja = el vendedor modificó el pedido (en verde lo que subió, en rojo lo que bajó). Ábralo, arme con las cantidades nuevas y toque «Visto». Si estaba armado, vuelve a «En armado».',
      'Si usted rebaja algo (faltó o empacó menos unidades), el vendedor lo ve destacado para avisarle al cliente.',
    ]],
    ['Despachar', ['Cuando el pedido tiene su documento aparece «Despachar». Un pedido solo de muestras se cierra con «Registrar salida».']],
    ['Recibir compras', [
      '«Compras» → «Por recibir»: lo que administración compró y cuándo llega. Cuando llegue el proveedor toque «Recibir» en esa compra.',
      '1) Documento: foto de la factura o guía, «Desde archivo» o «Sin documento». 2) Escanee la etiqueta de cada caja (peso, lote y vencimiento). 3) Confirme con su PIN: la pantalla compara lo que llegó con lo comprado.',
      'Si llega solo una parte, la compra queda «Parcial» y lo que falta se recibe en la próxima entrega. Si llega algo sin compra registrada, recíbalo igual desde «Recibir».',
    ]],
  ] },
  reparto: { title: 'Reparto', sections: [
    ACCESS,
    ['Entregar', ['En «Pedidos», columna Por despachar / Cerrado: toque «Entregar» y anote quién recibió. Fíjese en el horario de recepción de cada cliente.']],
  ] },
  produccion: { title: 'Producción', sections: [
    ACCESS,
    ['Qué producir', [
      '«Producción» abre con lo que esperan los pedidos, separado en «Para hoy», «Para mañana» y «Próximos días». Arriba de cada tarjeta, la cantidad a producir; abajo, cuántos pedidos esperan y el primero en entregarse.',
      'Una franja roja a la izquierda = pedido atrasado. Toque la tarjeta para ver los pedidos.',
      '«Todo el stock» muestra el stock de Bsale, lo reservado y lo disponible de cada formato, con buscador.',
    ]],
    ['Cargar lo producido', [
      '«Fotografiar planilla»: tome la foto, toque «Leer la foto», revise las cantidades (lo dudoso aparece en dorado) y toque «Cargar».',
      '«Registrar a mano»: busque el producto, elija el formato y escriba la cantidad. Los productos que esperan los pedidos aparecen arriba para agregarlos con un toque. El botón «Registrar» de cada tarjeta deja la cantidad lista.',
      'Toda carga se confirma con su PIN y queda en «Cargado hoy» a su nombre. Con las escrituras a Bsale encendidas entra a Bsale como recepción en la sala de proceso; mientras estén apagadas, la oficina la carga desde «Pendiente en Bsale».',
    ]],
    ['Armar y despachar', [
      'Producción también arma pedidos, igual que despacho: en «Pedidos» toque «Tomar» y luego «Armar», y use «Total en armado» para sumar lo que hay que ir a buscar.',
      'Cuando el pedido tiene su documento aparece «Despachar». Un pedido solo de muestras se cierra con «Registrar salida».',
    ]],
    ['Recibir compras', [
      '«Compras» → «Por recibir»: lo que administración compró y cuándo llega. Cuando llegue el proveedor toque «Recibir» en esa compra.',
      '1) Documento: foto de la factura o guía, «Desde archivo» o «Sin documento». 2) Escanee la etiqueta de cada caja (peso, lote y vencimiento). 3) Confirme con su PIN: la pantalla compara lo que llegó con lo comprado.',
      'Si llega solo una parte, la compra queda «Parcial» y lo que falta se recibe en la próxima entrega. Si llega algo sin compra registrada, recíbalo igual desde «Recibir».',
    ]],
  ] },
  admin: { title: 'Administración', sections: [
    ACCESS,
    ['Facturar', ['En «Pedidos», columna Por facturar: emita en el POS de Bsale con los pesos del armado y toque «Facturar» para vincular el documento (pide PIN). La reserva de stock se libera sola.', 'Si el documento trae el número del pedido en la referencia, o es del mismo RUT con un total parecido, Comandas lo marca «Sugerido»: revíselo y confírmelo.', '«Ver cómo lo facturaría Comandas» muestra la factura que emitiría la app (no emite nada). Compárela con la del POS: si calzan varios días seguidos, se enciende la facturación desde Comandas.']],
    ['Pendiente en Bsale', ['Su lista de trabajo del día: pedidos armados o entregados sin documento (con «Confirmar» cuando hay sugerencia), envíos a Bsale con error, producción y muestras que no llegaron a Bsale y clientes por revisar. Déjela en cero antes de irse.']],
    ['Compras', [
      '«Compras» → «Por recibir» → «+ Nueva compra»: proveedor, fecha en que llega y cada insumo con su cantidad (kg o unidades) y, si quiere, el precio. Si el insumo no existe, «Insumo nuevo».',
      'La fábrica la recibe contra esa compra y ve lo que falta. Si llega en partes, queda «Parcial»; cuando el proveedor ya no entregará el resto, «Cerrar con diferencia» con el motivo. Una compra sin recepciones se puede «Anular».',
      '«Recepciones» muestra lo que llegó, con el documento; «Stock de insumos», los lotes por insumo.',
    ]],
    ['Todo lo demás', ['Puede tomar pedidos, armar, despachar, ver el Panel y el Catálogo como los perfiles de operación. «Oportunidades» la ve en modo lectura.']],
  ] },
  superAdmin: { title: 'Super administración', sections: [
    ACCESS,
    ['Aprobar excepciones', ['Arriba del Tablero aparece «Pedidos por aprobar». Revise y apruebe o rechace con su PIN (rechazar anula el pedido con el motivo).']],
    ['Oportunidades', [
      '«+ Oportunidad»: elija el cliente, qué se busca, el ejecutivo y la primera acción con fecha. Sin ejecutivo queda en «Sin asignar».',
      '«Del informe»: marque los clientes del informe de oportunidades que quiere trabajar, elija el ejecutivo de cada uno y «Cargar».',
      '«Equipo»: abiertas, vencidas, postergadas, ganadas, perdidas, conversión y muestras por ejecutivo (90 días). Toque a alguien para ver sus abiertas.',
      'En cualquier oportunidad puede cambiar el ejecutivo y hacer lo mismo que él: registrar, postergar, dar por perdida o crear muestras y pedidos.',
    ]],
    ['Compras e insumos', [
      '«Por recibir»: las compras que registra administración (también puede registrarlas usted). La fábrica (producción y despacho) recibe contra ellas.',
      '«Recibir»: 1) «Con factura o guía»: foto del documento o «Desde archivo» (foto de la galería o PDF), que queda guardado y la app lee el timbre y las líneas; o «Sin documento», con el proveedor opcional; 2) «Escanear cajas»: cada etiqueta suma peso, lote y vencimiento, y la primera vez un código pregunta qué insumo es; 3) confirmar con su PIN. Cuadrar las líneas del documento con los insumos es opcional.',
      '«Recepciones»: el historial con su documento (toque la miniatura para abrirlo) y «+ Agregar foto o PDF», también para las compras sin documento. «Stock de insumos»: los lotes por insumo con su vencimiento y «+ Insumo nuevo».',
      '«Laboratorio»: escanee etiquetas o elija fotos y PDF para ver qué lee la app. No crea compras ni stock.',
    ]],
    ['Personas', ['«Usuarios» → «+ Agregar persona» o «Invitar con su historial» (trae los pedidos y la cartera de WhatsApp). Cada persona crea su PIN al entrar. Aquí se desactiva a alguien o se borra su PIN.']],
    ['Gestión', ['«Panel de gestión»: ventas de Bsale, margen, clientes, vendedores, stock y muestras (incluye kg de muestra por cliente nuevo). «Catálogo»: qué productos se ofrecen en pedidos.']],
    ['Facturar después de entregar', ['Desde «Facturar» puede «Despachar sin factura»; al entregarse aparece «Facturar» en Cerrado.']],
  ] },
  consultor: { title: 'Consulta', sections: [
    ACCESS,
    ['Qué puede ver', ['Todo en modo lectura: Panel de gestión, Ventana a Bsale, Pedidos, Oportunidades (con la vista Equipo), Clientes, Catálogo y Usuarios. No puede modificar nada.']],
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
