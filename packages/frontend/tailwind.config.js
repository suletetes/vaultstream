/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdaff',
          300: '#8ec3ff',
          400: '#59a2ff',
          500: '#337dfc',
          600: '#1d5df2',
          700: '#1549de',
          800: '#183cb4',
          900: '#19378d',
          950: '#142356',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card': '0 2px 8px -2px rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'elevated': '0 4px 16px -4px rgb(0 0 0 / 0.12), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};
