import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { Settings } from '@/domain/types';

const DEFAULT_SETTINGS: Settings = { cutoffHour: 15, timezone: 'America/Santiago' };

// Reads settings/app (cutoffHour, timezone). Falls back to sensible defaults
// while the doc is loading or if it is missing — no need to block wizard entry.
export function useSettings(): { settings: Settings; loading: boolean } {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'app'),
      (snap) => {
        if (snap.exists()) setSettings(snap.data() as Settings);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  return { settings, loading };
}
