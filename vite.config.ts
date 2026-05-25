import { defineConfig } from "vite";

export default defineConfig({
  base: "/svg-convert/",
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
