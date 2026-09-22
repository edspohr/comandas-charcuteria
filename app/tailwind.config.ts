import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf4ee',
          100: '#f9e3d0',
          500: '#c85a2b',
          600: '#a94820',
          700: '#823717',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
