import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
export function useClients() {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
            const list = [];
            snap.forEach((d) => list.push(d.data()));
            list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
            setClients(list);
            setLoading(false);
        });
        return unsub;
    }, []);
    return { clients, loading };
}
const norm = (s) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function searchClients(all, query) {
    if (!query.trim())
        return all.slice(0, 20);
    const q = norm(query);
    return all
        .filter((c) => norm(c.name).includes(q)
        || norm(c.fantasyName ?? '').includes(q)
        || norm(c.rut ?? '').includes(q))
        .slice(0, 20);
}
