// Marca de La Charcutería: una L de alto contraste (estilo didone) dentro de
// un cuadrado de línea fina. Emulación provisoria hasta tener el archivo
// original; dibujada como trazo SVG para no depender de fuentes.
// `tone`: 'light' sobre fondos oscuros (header, portada), 'dark' sobre crema.

type Tone = 'light' | 'dark';
const INK: Record<Tone, string> = { light: '#f4ede2', dark: '#14100c' };

// L path in a 100×100 box: hairline top serif, heavy stem, hairline foot
// with a bracketed beak on the right.
const L_PATH = [
  'M29 22.5 H51 V24.6 C47.6 24.8 46 25.6 46 28.4',   // top serif, right bracket
  'V73.4 H64 C69.6 73.4 72.4 70.6 74.2 64.6 H76',     // stem down, foot to beak
  'L74.6 76.4 H29 V74.3 C32.4 74.1 34 73.3 34 70.5', // beak, foot back, left bracket
  'V28.4 C34 25.6 32.4 24.8 29 24.6 Z',               // stem up, top-left bracket
].join(' ');

export function LogoMark({ size = 36, tone = 'light', title }: { size?: number; tone?: Tone; title?: string }) {
  const ink = INK[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="shrink-0">
      <rect x="5" y="5" width="90" height="90" fill="none" stroke={ink} strokeWidth={size < 40 ? 4 : 2.5} />
      <path d={L_PATH} fill={ink} />
    </svg>
  );
}

// Lockup completo de la portada: marca + "LA CHARCUTERÍA" + "TRADICIÓN ARTESANAL".
export function LogoLockup({ tone = 'light', size = 56 }: { tone?: Tone; size?: number }) {
  const ink = tone === 'light' ? 'text-cream-50' : 'text-charcoal-900';
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={size} tone={tone} />
      <div className={`leading-none ${ink}`}>
        <p className="font-serif text-[1.35em] tracking-[0.18em] uppercase">La Charcutería</p>
        <p className="mt-1.5 text-[0.55em] tracking-[0.42em] uppercase opacity-75">Tradición artesanal</p>
      </div>
    </div>
  );
}

export default function Logo({ size = 36, tone = 'light' }: { size?: number; tone?: Tone }) {
  return <LogoMark size={size} tone={tone} />;
}
