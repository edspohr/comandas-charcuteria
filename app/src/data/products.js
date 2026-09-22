import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
export function useProducts() {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'products'), (snap) => {
            const list = [];
            snap.forEach((d) => list.push(d.data()));
            list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
            setProducts(list);
            setLoading(false);
        });
        return unsub;
    }, []);
    return { products, loading };
}
