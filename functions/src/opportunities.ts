import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { REGION } from './common';

// Oportunidad ganada: cuando un pedido de venta ligado a una oportunidad
// recibe su documento de Bsale (vincular, facturar desde Comandas o facturar
// después de entregar). Las reglas no dejan que la app marque «ganada»: así
// cuenta solo la venta real. Los pedidos de muestras cierran con MU-… y no
// ganan nada.
export const opportunityWonOnInvoice = onDocumentUpdated({ document: 'orders/{orderId}', region: REGION }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const oppId = after.opportunityId as string | undefined;
  const ref = after.invoiceRef as string | undefined;
  if (!oppId || !ref || before.invoiceRef) return;
  if (after.kind === 'muestras' || after.kind === 'reposicion' || ref.startsWith('MU-')) return;

  const db = getFirestore();
  const oppRef = db.doc(`opportunities/${oppId}`);
  await db.runTransaction(async (tx) => {
    const opp = (await tx.get(oppRef)).data();
    if (!opp) return;
    const now = Date.now();
    const already = opp.status === 'ganada';
    tx.update(oppRef, {
      ...(already ? {} : { status: 'ganada', wonOrderId: event.params.orderId, wonAt: now, closedAt: now }),
      updatedAt: now,
      activity: FieldValue.arrayUnion({ type: 'estado', at: now, by: 'sistema', orderId: event.params.orderId, note: already ? `Nueva venta ${ref}` : `Ganada con ${ref}` }),
    });
  });
});
