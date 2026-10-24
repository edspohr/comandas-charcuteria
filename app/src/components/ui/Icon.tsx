// Íconos de línea de la app (24×24, trazo 1.8, color heredado).
const PATHS = {
  board: 'M4 4h5v16H4zM10 4h4v10h-4zM15 4h5v7h-5z',
  plus: 'M12 5v14M5 12h14',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-6 7-6s7 2.1 7 6M16 3.5a4 4 0 0 1 0 7.5M18 14.5c2.4.8 4 2.6 4 5.5',
  factory: 'M3 21V10l6 4V10l6 4V6h6v15zM7 21v-3m5 3v-3m5 3v-3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  window: 'M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9',
  key: 'M14 10a5 5 0 1 0-4.6 5L8 16.5V19H5.5v2H3v-3.5l6-6A5 5 0 0 0 14 10zM16.5 7.5h.01',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'm6 9 6 6 6-6',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  sync: 'M20 11a8 8 0 0 0-14.6-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.4L20 16M20 20v-4h-4',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={'shrink-0 ' + className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
