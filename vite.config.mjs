import { defineConfig } from "vite";

// Im Entwicklungsserver (npm run dev) injiziert Vite Stile und Neuladen-Code inline und per WebSocket; die strenge CSP aus
// index.html (script-src 'self', style-src 'self', connect-src 'none') würde das blockieren. Darum ersetzt dieses Plugin die
// CSP nur beim Serve durch eine lockere Fassung. Der gebaute Stand (dist/, npm run preview) behält die strenge CSP.
function devRelaxedCsp() {
  return {
    name: "dev-relaxed-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,
        "$1default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws:; object-src 'none'$2",
      );
    },
  };
}

export default defineConfig({
  // relativ, damit dieselbe Ausgabe unter https://even512.github.io/InkAndEmbers-web/ und lokal läuft
  base: "./",
  plugins: [devRelaxedCsp()],
  // GIF-Worker (src/share/gif.worker.mjs) als ES-Modul bündeln, Ausgabe unter assets/ (gleiche Herkunft, worker-src 'self')
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // nichts als data:-URL einbetten (font-src 'self' erlaubt keine data:-Schriften)
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
  },
});
