import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { Product } from '@/domain/types';

export function useProducts(): { products: Product[]; loading: boolean } {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snap) => {
      const list: Product[] = [];
      snap.forEach((d) => list.push(d.data() as Product));
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setProducts(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { products, loading };
}
