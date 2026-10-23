import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy forwards /api to the Fastify backend, so the browser never talks to
// AWS directly and no credentials are ever exposed client-side.
export default defineConfig(({ mode }) => {
  // Load repo-root .env (two levels up) so ports stay configurable.
  const env = loadEnv(mode, new URL("../../", import.meta.url).pathname, "");
  const backendPort = env.BACKEND_PORT || "8787";
  const backendHost = env.BACKEND_HOST || "127.0.0.1";
  const frontendPort = Number(env.FRONTEND_PORT || "5173");

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
