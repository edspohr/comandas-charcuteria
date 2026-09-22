import type { Config } from 'tailwindcss';

// Palette derived from lacharcuteriartesanal.cl:
//   - deep charcoal for structure and headings
//   - warm cream backgrounds
//   - muted brass/gold as the single accent (seal, active states)
//   - warm wood for secondary emphasis (borders, muted highlights)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream:   { 50: '#faf7f2', 100: '#f4ede2', 200: '#e9ddc9', 300: '#d9c7a4' },
        charcoal:{ 50: '#f5f4f2', 100: '#e5e2dd', 200: '#c4bfb7', 300: '#8b8177', 500: '#3a332d', 700: '#221c17', 900: '#14100c' },
        brass:   { 50: '#faf3e1', 100: '#efe2b8', 300: '#d4b676', 500: '#a8834a', 600: '#8a6a3a', 700: '#6b512b' },
        wood:    { 100: '#e6d9c4', 300: '#b39776', 500: '#7a5f42', 700: '#4d3b28' },
      },
      fontFamily: {
        sans:    ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        display: '0.06em',
      },
      boxShadow: {
        soft:  '0 1px 2px rgba(20, 16, 12, 0.05), 0 4px 12px rgba(20, 16, 12, 0.04)',
        lift:  '0 2px 6px rgba(20, 16, 12, 0.08), 0 10px 28px rgba(20, 16, 12, 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
