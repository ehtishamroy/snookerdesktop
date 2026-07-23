// CommonJS on purpose — see postcss.config.js's header comment.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}", "./index.html"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // Large, high-contrast palette tuned for a fast-moving counter UI
        // viewed on a standard desktop monitor, sometimes in dim rooms.
        vacant: {
          DEFAULT: "#16a34a",
          dark: "#166534",
        },
        occupied: {
          DEFAULT: "#dc2626",
          dark: "#7f1d1d",
        },
        inactive: {
          DEFAULT: "#9ca3af",
          dark: "#4b5563",
        },
      },
      fontSize: {
        tile: ["2.5rem", { lineHeight: "1.1", fontWeight: "800" }],
      },
      spacing: {
        touch: "3.5rem",
      },
    },
  },
  plugins: [],
};
