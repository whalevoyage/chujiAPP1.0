import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'

const APP_VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      workbox: {
        // 关键：不预缓存 HTML — index.html 必须每次从网络获取，
        // 否则手机端的旧 Service Worker 会一直返回旧页面
        globPatterns: ['**/*.{js,css,svg,png,ico,json,woff2}'],
        // SPA 路由回退到 index.html（从网络获取，不缓存）
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // 导航请求：NetworkFirst，确保 index.html 始终是最新的
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: 'NetworkOnly',
            // User writes must not be replayed later: delete, restore and check-in
            // operations are not all idempotent, and API responses are private.
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        version: APP_VERSION,
        name: '初记 - Student Growth OS',
        short_name: '初记',
        description: '从每日计划、执行与复盘，沉淀大学成长档案',
        theme_color: '#F7F4EE',
        background_color: '#F7F4EE',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        categories: ['productivity', 'lifestyle'],
        prefer_related_applications: true,
        related_applications: [
          {
            platform: 'play',
            url: 'https://play.google.com/store/apps/details?id=com.chuji.personal',
            id: 'com.chuji.personal',
          },
        ],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      } as Partial<ManifestOptions> & { version: string },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 8787,
  },
  build: {
    target: 'es2020',
    cssMinify: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor'
          if (id.includes('node_modules/lucide-react')) return 'icons'
        },
      },
    },
  },
})
