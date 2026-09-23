import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { adminApi } from './admin/server/adminApi'

// The Admin Console (news-sourcing-design.md §14) — a SEPARATE Vite app from
// the globe, deliberately:
//   - it is private tooling, and `npm run build` must never emit it into
//     dist/ alongside the public app;
//   - it only works with its own dev-server middleware behind it (adminApi),
//     so there is no meaningful production build of it to ship;
//   - the globe's config carries bundle concerns (manualChunks for three/
//     fiber) that mean nothing here, the same reason vitest.config.ts is its
//     own file rather than a merge.
//
// Bound to loopback on its own port so it can run alongside `npm run dev`.
export default defineConfig({
  root: 'admin',
  plugins: [react(), tailwindcss(), adminApi()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    // The console's modules live outside its root (src/news/ — the same pure
    // modules the build uses, so the console can't disagree with the build
    // about what a valid source record is).
    fs: { allow: ['..'] },
  },
})
