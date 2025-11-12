import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Тюнер палочек',
        short_name: 'Тюнер',
        description: 'Подбор барабанных палочек по тону (PWA)',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: []
      }
    })
  ],
  server: { host: true }
});
