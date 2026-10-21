/**
 * Tailwind theme for the ported design panels: a faithful port of
 * extend-design-skill auto_agent_frontend/tailwind.config.js, scoped to the
 * design dock. Content is limited to the ported client tree; preflight is off
 * (the host page owns global resets — see ported/design.css for the scoped
 * base layer).
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/client/**/*.{ts,tsx}'],
  safelist: ['dsh-design-root'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      xs: '500px',
      'card-md': '1044px',
      'card-lg': '1558px',
      'card-xl': '2082px',
    },
    extend: {
      zIndex: {
        base: '0',
        content: '1',
        elevated: '10',
        navbar: '100',
        sidebar: '200',
        header: '300',
        dropdown: '1000',
        popover: '1100',
        tooltip: '1200',
        'context-menu': '1300',
        overlay: '5000',
        modal: '6000',
        drawer: '6500',
        sheet: '6600',
        notification: '8000',
        toast: '8500',
        loading: '9000',
        debug: '9999',
      },
      colors: {
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        disabled: {
          DEFAULT: 'hsl(var(--disabled))',
          foreground: 'hsl(var(--disabled-foreground))',
        },
        hover: 'hsl(var(--hover))',
        focus: 'hsl(var(--focus))',
        active: 'hsl(var(--active))',
        selection: 'hsl(var(--selection))',
        overlay: 'hsl(var(--overlay))',
        skeleton: 'hsl(var(--skeleton))',
        text: {
          primary: 'hsl(var(--text-primary))',
          secondary: 'hsl(var(--text-secondary))',
          muted: 'hsl(var(--text-muted))',
          link: 'hsl(var(--text-link))',
        },
        surface: 'hsl(var(--surface))',
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        tooltip: {
          DEFAULT: 'hsl(var(--tooltip))',
          foreground: 'hsl(var(--tooltip-foreground))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
          primary: 'hsl(var(--chart-primary))',
          secondary: 'hsl(var(--chart-secondary))',
        },
        'status-active': 'hsl(var(--status-active))',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        xs: '0.125rem',
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        button: 'var(--button-radius)',
        input: 'var(--input-radius)',
        card: 'var(--radius)',
        'card-sm': 'calc(var(--radius) - 2px)',
        'card-xs': 'calc(var(--radius) - 4px)',
        full: '9999px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
      },
      fontFamily: {
        sans: ['var(--font-main)'],
        mono: ['var(--font-code)'],
        display: ['var(--font-display)'],
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    // Backport of the Tailwind 3.4 size-* utilities (the original pins 3.3.5
    // with the same shim; size-N is pervasive in the Design tree).
    require('tailwindcss/plugin')(({ matchUtilities, theme }) => {
      matchUtilities(
        { size: (value) => ({ width: value, height: value }) },
        { values: theme('spacing') },
      )
    }),
  ],
}
