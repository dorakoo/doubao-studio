/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  // 深色主题为核心，Ant Design 5 使用 CSS-in-JS，互不冲突
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 豆包工作室品牌色系 - 深色创作者工具风格
        'db-bg': {
          DEFAULT: '#0f0f14',
          secondary: '#1a1a24',
          tertiary: '#24243a',
        },
        'db-surface': {
          DEFAULT: '#1e1e2e',
          hover: '#2a2a3e',
          active: '#32324a',
        },
        'db-border': {
          DEFAULT: '#2a2a3e',
          light: '#38385a',
        },
        'db-accent': {
          DEFAULT: '#6c5ce7', // 主紫色
          light: '#a29bfe',
          dark: '#5a4bd1',
        },
        'db-text': {
          primary: '#e8e8f0',
          secondary: '#9898b8',
          muted: '#686888',
        },
        'db-status': {
          idle: '#4ade80',    // 空闲 - 绿色
          busy: '#fbbf24',    // 忙碌 - 琥珀色
          error: '#f87171',   // 异常 - 红色
          queued: '#60a5fa',  // 排队中 - 蓝色
          done: '#34d399',    // 已完成 - 翠绿
          fail: '#fb7185',    // 失败 - 玫红
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '0.9rem' }],
      },
      borderRadius: {
        'db': '8px',
        'db-lg': '12px',
      },
      boxShadow: {
        'db': '0 2px 8px rgba(0, 0, 0, 0.4)',
        'db-lg': '0 8px 32px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
  // 确保不与 Ant Design 样式冲突
  important: false,
};
