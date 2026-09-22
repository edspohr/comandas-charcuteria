// Wax-seal-inspired mark. Circular brass border, tight monogram, no image asset.
// Used at multiple sizes across the app; tune with the `size` prop.
export default function Logo({ size = 36 }: { size?: number }) {
  const s = `${size}px`;
  return (
    <span
      aria-hidden
      style={{ width: s, height: s, fontSize: Math.round(size * 0.36) }}
      className="seal shrink-0 bg-cream-50"
    >
      LC
    </span>
  );
}
