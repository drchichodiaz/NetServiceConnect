import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'monospace'],
      },
      colors: {
        green: {
          50:  '#f0fdf6',
          100: '#dcfced',
          200: '#bbf7d8',
          300: '#86efb8',
          400: '#4ade8a',
          500: '#25D366',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        sidebar: {
          DEFAULT: '#0D1117',
          hover:   '#161B22',
          active:  '#1C2128',
          border:  '#21262D',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted:   '#F5F6FA',
          subtle:  '#F0F1F5',
        },
        ink: {
          DEFAULT: '#1A1D23',
          muted:   '#6B7280',
          subtle:  '#9CA3AF',
          ghost:   '#D1D5DB',
        },
        border: {
          DEFAULT: '#E8EAED',
          strong:  '#D1D5DB',
        },
      },
      boxShadow: {
        'card':   '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-md':'0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)',
        'float':  '0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.10)',
        'inner-sm': 'inset 0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%':   { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pop': {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out both',
        'slide-in': 'slide-in 0.2s ease-out both',
        'pop':      'pop 0.15s ease-out both',
        'pulse-dot':'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
