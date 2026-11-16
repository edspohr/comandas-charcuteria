import { useEffect, useState } from 'react';
// Conserva el identificador de operación junto con el borrador para que un
// reintento después de recargar no vuelva a registrar el mismo movimiento.
export function usePersistentForm<T>(key: string, initial: () => T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); if (saved) return JSON.parse(saved) as T; } catch { /* almacenamiento no disponible */ }
    return initial();
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* el formulario sigue funcionando */ } }, [key, state]);
  return [state, setState];
}
