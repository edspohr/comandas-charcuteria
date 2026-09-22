import { jsx as _jsx } from "react/jsx-runtime";
// Wax-seal-inspired mark. Circular brass border, tight monogram, no image asset.
// Used at multiple sizes across the app; tune with the `size` prop.
export default function Logo({ size = 36 }) {
    const s = `${size}px`;
    return (_jsx("span", { "aria-hidden": true, style: { width: s, height: s, fontSize: Math.round(size * 0.36) }, className: "seal shrink-0 bg-cream-50", children: "LC" }));
}
