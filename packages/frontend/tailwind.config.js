/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        argon: {
          bg: '#F5F0E8',         // Primary drafting vellum canvas
          surface: '#EAE0D2',    // Tool trays, secondary cards
          card: '#FFF9F0',       // Main ivory card surface
          border: '#D8CAB8',     // Muted stone divider lines
          text: '#302820',       // Deep drafting ink
          muted: '#6F6257',      // Architectural annotations
          btn: '#80644D',        // Warm bronze leather primary button
          btnHover: '#654B38',   // Burnished bronze hover
          accent: '#B99270',     // Subtle ochre selection badge
          pass: '#4A6B53',       // Sage green compliance pass
          warn: '#C48A3F',       // Amber advisory notice
          error: '#9E4738',      // Brick red geometry clash
        },
      },
    },
  },
  plugins: [],
};
