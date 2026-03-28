/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f4ff',
          900: '#0F1F3D',
          950: '#080f1e',
        },
        teal: {
          400: '#2dd4bf',
          500: '#00C9A7',
          600: '#009e85',
        },
        claw: '#E8693C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
