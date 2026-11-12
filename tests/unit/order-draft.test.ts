import { describe, expect, it } from 'vitest';
import { withDraftFormats } from '../../app/src/domain/orderDraft';
import { computeLineSubtotal } from '../../app/src/lib/pricing';
import type { Product, ProductFormat } from '../../app/src/domain/types';
const product:Product={id:'p',name:'Producto QA',category:'qa',active:true,discontinued:false,formats:[{formatId:'kg',label:'Kg',unit:'kg',pricePerKgCLP:1000}]};
describe('valorización de pedidos pegados o repetidos',()=>{
 it('recupera el precio desde producto y formato',()=>{const source:Array<{productId:string;formatId:string;qty:number;format?:ProductFormat}>=[{productId:'p',formatId:'kg',qty:3}];const lines=withDraftFormats(source,[product]);expect(lines[0].format).toEqual(product.formats[0]);expect(computeLineSubtotal(lines[0].format!,lines[0].qty)).toBe(3000);});
 it('conserva un precio ya mostrado y no altera muestras',()=>{const lines=[{productId:'p',formatId:'kg',format:{...product.formats[0],pricePerKgCLP:900}},{productId:'p',formatId:'kg',sample:true}];expect(withDraftFormats(lines,[product])).toBe(lines);});
 it('espera al catálogo y sólo modifica el borrador una vez',()=>{const lines=[{productId:'p',formatId:'kg'}];expect(withDraftFormats(lines,[])).toBe(lines);const filled=withDraftFormats(lines,[product]);expect(withDraftFormats(filled,[product])).toBe(filled);});
});
