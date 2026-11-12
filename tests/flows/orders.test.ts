import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { deleteApp, type FirebaseApp } from 'firebase/app';

import type { Client } from '../../app/src/domain/types';
const project='demo-comandas-qa';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8080';
const client:Client={id:'qa-client',name:'Cliente de otra cartera SPA',rut:'78.205.279-9',deliveryMode:'despacho',invoicingComplete:true};
const line={productId:'qa-product',productName:'Producto QA',formatId:'kg',formatLabel:'Kg',unit:'kg' as const,qty:3,format:{formatId:'kg',label:'Kg',unit:'kg' as const,pricePerKgCLP:1000}};
const input=(qty=3,stockSource:'fabrica'|'tienda'='fabrica')=>({client,stockSource,lines:[{...line,qty}],requestedDate:'2026-11-13',deliveryMode:'despacho' as const,deliveryWindow:{note:'En la mañana'},source:'app' as const});
let adm:ReturnType<typeof initializeAdmin>, db:ReturnType<typeof adminFirestore>;
const apps:FirebaseApp[]=[];
async function session(uid:string){
 const mod=await import(`../../private/qa-runtime/bundles/${uid}.mjs`);
 await mod.qaAuth.signInWithEmailAndPassword(mod.auth,`${uid}@qa.invalid`,'qa-password-4827');
 if(!apps.includes(mod.db.app))apps.push(mod.db.app);
 return{orders:mod,store:mod.db,sdk:mod.qaSdk};
}

describe.skipIf(!enabled)('flujos reales del SDK contra emuladores, sin Bsale real',()=>{
 beforeAll(async()=>{
  if(!project.startsWith('demo-'))throw Error('Destino inseguro');
  process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
  adm=initializeAdmin({projectId:project});db=adminFirestore(adm);
  for(const [uid,role] of [['seller-a','vendedor'],['seller-b','vendedor'],['packer','despacho'],['admin','admin'],['driver','reparto']]){
   try{await adminAuth(adm).createUser({uid,email:`${uid}@qa.invalid`,password:'qa-password-4827'});}catch(e:any){if(e.code!=='auth/uid-already-exists'&&e.code!=='auth/email-already-exists')throw e;}
   await adminAuth(adm).setCustomUserClaims(uid,{role});
  }
 });
 beforeEach(async()=>{
  const old=await db.collection('orders').where('createdBy','in',['seller-a','seller-b']).get();
  const batch=db.batch();old.docs.forEach(d=>batch.delete(d.ref));await batch.commit();
  await db.doc('clients/qa-client').set({...client,ownerUid:'seller-b'});
  await db.doc('products/qa-product').set({id:'qa-product',name:'Producto QA',active:true,discontinued:false,category:'qa',formats:[line.format]});
  await db.doc('stock/qa-product__kg').set({productId:'qa-product',formatId:'kg',onHand:10,reserved:0,storeOnHand:8,storeReserved:0});
 });
 afterAll(async()=>{await Promise.all(apps.map(deleteApp));await deleteAdmin(adm);});
 it('un vendedor busca y toma pedidos de la cartera de otro; reserva sin rebajar Bsale',async()=>{
  const s=await session('seller-a');const clients=await s.sdk.getDocs(s.sdk.collection(s.store,'clients'));expect(clients.docs.some(d=>d.id==='qa-client')).toBe(true);
  const r=await s.orders.createOrder('seller-a',input());
  expect((await db.doc(`orders/${r.orderId}`).get()).data()).toMatchObject({clientId:client.id,status:'confirmado',stockSource:'fabrica',totalCLP:3000});
  expect((await db.doc('stock/qa-product__kg').get()).data()).toMatchObject({onHand:10,reserved:3,storeOnHand:8,storeReserved:0});
 });
 it('un pedido pegado o repetido sin precio recupera el formato del catálogo y queda valorizado',async()=>{
  const a=await session('seller-a');const {format,...withoutPrice}=line;
  const r=await a.orders.createOrder('seller-a',{...input(),source:'pasted',lines:[withoutPrice]});
  expect((await db.doc(`orders/${r.orderId}`).get()).data()).toMatchObject({totalCLP:3000,lines:[{productId:'qa-product',unitPriceSnapshotCLP:1000,subtotalCLP:3000}]});
 });
 it('una creación con identidad falsa no se reintenta ni escribe datos',async()=>{
  const a=await session('seller-a');const before=(await db.doc('counters/orders-2026').get()).get('last');
  await expect(a.orders.createOrder('seller-b',input())).rejects.toThrow();
  expect((await db.doc('counters/orders-2026').get()).get('last')).toBe(before);
 });
 it('dos vendedores simultáneos no sobre-reservan tienda y la segunda sesión recibe la actualización',async()=>{
  const a=await session('seller-a'),b=await session('seller-b');
  const seen:number[]=[];const stop=b.sdk.onSnapshot(b.sdk.doc(b.store,'stock/qa-product__kg'),s=>seen.push(s.get('storeReserved')));
  try{
   const results=await Promise.all([a.orders.createOrder('seller-a',input(6,'tienda')),b.orders.createOrder('seller-b',input(6,'tienda'))]);
   expect(new Set(results.map(r=>r.orderId)).size).toBe(2);
   const s=(await db.doc('stock/qa-product__kg').get()).data()!;expect(s).toMatchObject({onHand:10,reserved:0,storeOnHand:8,storeReserved:8});
   const os=await db.collection('orders').where('createdBy','in',['seller-a','seller-b']).get();expect(os.docs.reduce((n,d)=>n+d.get('lines')[0].pendingProductionQty,0)).toBe(4);
   await vi.waitFor(()=>expect(seen).toContain(8));
  }finally{stop();}
 });
 it('editar y anular liberan sólo la reserva de la sucursal correcta',async()=>{
  const a=await session('seller-a');const r=await a.orders.createOrder('seller-a',input(3,'tienda'));
  await a.orders.editOrderLines(r.orderId,[{...line,qty:1}],'seller-a');
  expect((await db.doc('stock/qa-product__kg').get()).data()).toMatchObject({reserved:0,storeReserved:1});
  await a.orders.anularOrder(r.orderId,'seller-a','prueba QA');
  expect((await db.doc('stock/qa-product__kg').get()).data()).toMatchObject({onHand:10,reserved:0,storeOnHand:8,storeReserved:0});
 });
 it('el otro vendedor no puede modificar ni anular el pedido',async()=>{
  const a=await session('seller-a'),b=await session('seller-b');const r=await a.orders.createOrder('seller-a',input());
  await expect(b.orders.anularOrder(r.orderId,'seller-b','no autorizado')).rejects.toThrow();
  expect((await db.doc(`orders/${r.orderId}`).get()).get('status')).toBe('confirmado');
 });
 it('vendedor → armado → documento → despacho → entrega conserva la reserva hasta facturar',async()=>{
  const a=await session('seller-a');const r=await a.orders.createOrder('seller-a',input());
  const p=await session('packer');await p.orders.assignPacker(r.orderId,'packer');
  await p.orders.markArmado(r.orderId,[{productId:'qa-product',formatId:'kg',packedQty:3}],'packer',{strictStock:true});
  expect((await db.doc('stock/qa-product__kg').get()).get('reserved')).toBe(3);
  const admin=await session('admin');
  await db.doc('bsaleDocuments/test-invoice').set({id:'test-invoice',number:'FA-991001',officeId:1,clientRut:client.rut,clientName:client.name,type:'factura',totalCLP:3000,details:[],emittedAt:Date.now(),emissionDate:'2026-11-12'});
  await db.doc('stock/qa-product__kg').update({onHand:7});
  await admin.orders.vincularDocumento(r.orderId,{id:'test-invoice',number:'FA-991001'},'admin');
  expect((await db.doc('stock/qa-product__kg').get()).data()).toMatchObject({onHand:7,reserved:0});
  await p.orders.despacharOrder(r.orderId,'packer','driver');
  const driver=await session('driver');await driver.orders.entregarOrder(r.orderId,'driver','Recibido QA');
  expect((await db.doc(`orders/${r.orderId}`).get()).get('status')).toBe('entregado');
 });
 it('el alta con un RUT existente se detiene y no crea otro cliente',async()=>{
  const before=(await db.collection('clients').get()).size;const {orders:{createClientQuick}}=await session('seller-a');
  await expect(createClientQuick({fantasyName:'Otro local',rut:'78205279-9',deliveryMode:'despacho'},'seller-a')).rejects.toThrow('ya existe');
  expect((await db.collection('clients').get()).size).toBe(before);
 });
});
