/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        civic: {
          50: '#F2F8F6',
          100: '#E1EFEA',
          200: '#C5DFD7',
          300: '#A4CAC0',
          400: '#5F9E90',
          500: '#2F6F63', // Primary brand deep civic green
          600: '#255A50',
          700: '#1D453E',
          800: '#16332E',
          900: '#0F221E',
          950: '#091512',
        },
        sage: {
          50: '#F5F8F7',
          100: '#E6EFEA',
          200: '#CFE0D9',
          300: '#B0C9BF',
          400: '#82AFA3', // Secondary accent sage
          500: '#6B9B8E',
          600: '#537C71',
          700: '#3E5C54',
          800: '#2C403A',
        },
        'muted-blue': {
          50: '#F3F7FD',
          100: '#E3EDFA',
          200: '#C9DDF6',
          300: '#A4C4EE',
          400: '#6F9BD8', // Civic data accent blue
          500: '#5282C4',
          600: '#3C67A3',
          700: '#2B4A77',
        },
        coral: {
          50: '#FDF4F3',
          100: '#FCE7E6',
          200: '#F8D0CD',
          300: '#F1AFA8',
          400: '#E68E86',
          500: '#D97870', // Restrained alert coral
          600: '#C45E56',
          700: '#A84841',
        },
        charcoal: {
          50: '#F6F8F7',
          100: '#EBEEED',
          200: '#D5DAD8',
          300: '#B2BDB9',
          400: '#7F918C',
          500: '#5F6F6A', // Muted gray-green secondary text
          600: '#485551',
          700: '#33403D',
          800: '#242F2C',
          900: '#1F2927', // Strong dark charcoal primary text
          950: '#131A18',
        },
        ivory: {
          50: '#FAFCFA',
          100: '#F7F9F7', // Warm off-white foundation
          200: '#EEF2EE',
          300: '#E4EAE4', // Subtle border
          400: '#D5DDD5',
        },
        surface: {
          50: '#FFFFFF',
          100: '#F7F9F7',
          200: '#EEF2EE',
          300: '#E4EAE4',
          700: '#33403D',
          800: '#242F2C',
          900: '#1F2927',
        },
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgba(31, 41, 39, 0.04)',
        'card': '0 2px 8px -2px rgba(47, 111, 99, 0.06), 0 1px 4px -1px rgba(31, 41, 39, 0.04)',
        'card-hover': '0 10px 24px -4px rgba(47, 111, 99, 0.10), 0 4px 10px -2px rgba(31, 41, 39, 0.05)',
        'floating': '0 16px 36px -6px rgba(31, 41, 39, 0.12), 0 6px 16px -4px rgba(47, 111, 99, 0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
