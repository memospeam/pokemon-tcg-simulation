import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Optional Groq API key for the in-app LLM agent (Simulate / Play vs LLM).
// Read server-side ONLY (NOT a VITE_ var) so it is never inlined into the
// browser bundle. Start the dev server with it via:  GROQ_API_KEY=gsk_… npm run dev
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      // Same-origin proxy to Groq's OpenAI-compatible API. The browser LLM
      // client points VITE_LLM_BASE_URL at "/api/groq", so it calls
      //   /api/groq/chat/completions   (same origin → no CORS)
      // which is forwarded to https://api.groq.com/openai/v1/chat/completions
      // with the Authorization header attached here on the server side.
      "/api/groq": {
        target: "https://api.groq.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/groq/, "/openai/v1"),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (GROQ_API_KEY) proxyReq.setHeader("Authorization", `Bearer ${GROQ_API_KEY}`);
          });
        },
      },
    },
  },
});
