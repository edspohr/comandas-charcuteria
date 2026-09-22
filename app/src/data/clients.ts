import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { Client } from '@/domain/types';

export function useClients(): { clients: Client[]; loading: boolean } {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      const list: Client[] = [];
      snap.forEach((d) => list.push(d.data() as Client));
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setClients(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { clients, loading };
}

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function searchClients(all: Client[], query: string): Client[] {
  if (!query.trim()) return all.slice(0, 20);
  const q = norm(query);
  return all
    .filter((c) => norm(c.name).includes(q)
      || norm(c.fantasyName ?? '').includes(q)
      || norm(c.rut ?? '').includes(q))
    .slice(0, 20);
}
