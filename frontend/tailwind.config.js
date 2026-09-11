/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          blue: "#2563eb",
          green: "#16a34a",
          amber: "#d97706",
          red: "#dc2626",
          lime: "#65a30d",
        },
      },
    },
  },
  plugins: [],
};
