/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // 暗色主题色板
        bg: {
          base: '#0a0e1a', // 主背景
          card: '#131826', // 卡片背景
          hover: '#1a2236', // 悬停
          input: '#0f1521', // 输入框
        },
        border: {
          base: '#1f2940',
          active: '#3b4a73',
        },
        text: {
          primary: '#e4e7ef',
          secondary: '#9ca3b8',
          muted: '#5a6378',
        },
        accent: {
          cyan: '#22d3ee',
          purple: '#a78bfa',
          green: '#4ade80',
          red: '#f87171',
          yellow: '#fbbf24',
          blue: '#60a5fa',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
