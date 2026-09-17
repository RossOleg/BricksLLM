import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Панель отдаётся Go-бинарём по /admin и оттуда же ходит в API, поэтому пути
// собираются относительно /admin/, а в разработке тот же origin изображает
// прокси: без него браузер упрётся в CORS, которого на админ-сервере нет.
export default defineConfig(({ mode }) => ({
  base: "/admin/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: process.env.BRICKSLLM_ADMIN_URL || "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
