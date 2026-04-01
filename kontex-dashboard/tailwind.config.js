/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0A0A0B",
        surface:  "#111113",
        border:   "#1E1E22",
        muted:    "#3A3A42",
        text:     "#E8E8ED",
        subtle:   "#6B6B7A",
        teal:     "#00E5CC",
        amber:    "#F5A623",
        red:      "#FF4D4D",
        green:    "#2ECC71",
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "monospace"],
        sans: ["DM Sans", "sans-serif"],
      },
      fontSize: {
        "2xs": "0.65rem",
      },
    },
  },
  plugins: [],
};

