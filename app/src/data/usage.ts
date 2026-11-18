import { useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { isLocked } from './auth';

export interface UserUsage { firstSeenAt: number; lastSeenAt: number; days: string[] }
const record = httpsCallable(functions, 'recordAppUsage');
let lastUid = '';
let lastSent = 0;
let pending = false;

// Record opening/unlocking and actual interaction, never idle background time.
export function useUsageTracking(uid: string | undefined, unlocked: boolean) {
  useEffect(() => {
    if (!uid || !unlocked) return;
    const report = () => {
      if (document.visibilityState !== 'visible' || isLocked() || pending) return;
      if (lastUid === uid && Date.now() - lastSent < 5 * 60_000) return;
      pending = true;
      lastUid = uid;
      lastSent = Date.now();
      void record().catch(() => { lastSent = 0; }).finally(() => { pending = false; });
    };
    report();
    window.addEventListener('pointerdown', report, { passive: true });
    window.addEventListener('keydown', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('pointerdown', report);
      window.removeEventListener('keydown', report);
      document.removeEventListener('visibilitychange', report);
    };
  }, [uid, unlocked]);
}
