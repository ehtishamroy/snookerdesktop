import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "media",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff7ff",
          100: "#dbecfe",
          200: "#bfdffe",
          300: "#93cbfd",
          400: "#60affa",
          500: "#3b8ff5",
          600: "#256fea",
          700: "#1d59d6",
          800: "#1e49ad",
          900: "#1e4089",
          950: "#172a54",
        },
        felt: {
          50: "#eefbf3",
          100: "#d5f5e0",
          200: "#aeeac6",
          300: "#78d8a6",
          400: "#43bd82",
          500: "#219f68",
          600: "#158053",
          700: "#106645",
          800: "#0f5138",
          900: "#0d4230",
          950: "#062419",
        },
      },
      boxShadow: {
        tile: "0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 1px rgb(0 0 0 / 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
