import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        burgundy: {
          50:  "#fdf2f4",
          100: "#fce7ea",
          200: "#f8ccd3",
          300: "#f3a2b1",
          400: "#eb6e87",
          500: "#de4162",
          600: "#c82b4c",
          700: "#a8203c",
          800: "#7e1e33",
          900: "#5c1c2d",
          950: "#3d0c18",
        },
      },
    },
  },
  plugins: [],
};

export default config;
