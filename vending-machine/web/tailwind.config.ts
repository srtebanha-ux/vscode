import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: '#0b1120', accent: '#2563eb' },
      maxWidth: { prose: '68ch' },
    },
  },
  plugins: [],
} satisfies Config;
