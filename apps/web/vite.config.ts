import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// ARTIFACT=1: página única (tudo inline, sem PWA/servidor) para publicar como artifact.
const artifact = process.env.ARTIFACT === '1';

const server = process.env.DEV_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  publicDir: artifact ? false : 'public',
  build: artifact
    ? { assetsInlineLimit: 100_000_000, outDir: 'dist-artifact', cssCodeSplit: false }
    : {},
  plugins: [
    react(),
    ...(artifact
      ? [viteSingleFile()]
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icons/icon.png'],
            manifest: {
              name: 'Buraco Online',
              short_name: 'Buraco',
              description: 'Buraco Aberto online para 2 a 4 jogadores, com voz e ranking.',
              lang: 'pt-BR',
              start_url: '/',
              display: 'standalone',
              display_override: ['fullscreen', 'standalone'],
              orientation: 'any',
              background_color: '#0b3b2a',
              theme_color: '#0b3b2a',
              icons: [
                { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: '/icons/icon-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              runtimeCaching: [
                {
                  urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
                  handler: 'CacheFirst',
                  // CacheFirst: ao trocar um arquivo de /assets sem mudar o nome, suba a versão
                  options: { cacheName: 'assets-v2', expiration: { maxEntries: 150 } },
                },
              ],
              globPatterns: ['**/*.{js,css,html,svg,png}'],
              navigateFallbackDenylist: [/^\/api/, /^\/ws/],
            },
          }),
        ]),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
});
