import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base` : sous-dossier où le site est servi. GitHub Pages sert un dépôt « Dossard » sous
// https://astiricx.github.io/Dossard/, donc la compilation publiée utilise « /Dossard/ ». Le workflow
// le fournit par la variable BASE_PATH, tirée du nom du dépôt. En local (npm run dev, ou une
// compilation lancée à la main), la variable est absente et l'application reste à la racine.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
});
