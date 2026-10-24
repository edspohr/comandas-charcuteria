import { useEffect } from 'react';

// Freezes the page behind an open sheet or dialog. iOS Safari ignores
// overflow:hidden on body, so the body is pinned with position:fixed at the
// current offset and restored on close. Nested locks are counted.
let locks = 0;
let savedY = 0;

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks++ === 0) {
      savedY = window.scrollY;
      const b = document.body.style;
      b.position = 'fixed'; b.top = `-${savedY}px`; b.left = '0'; b.right = '0'; b.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) {
        const b = document.body.style;
        b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.overflow = '';
        window.scrollTo(0, savedY);
      }
    };
  }, [active]);
}
