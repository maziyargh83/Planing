import pandacss from "@pandacss/dev/postcss";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const api = `http://127.0.0.1:${process.env.GAAM_PORT ?? 4777}`;
const web = (p: string) => fileURLToPath(new URL(`./web/${p}`, import.meta.url));

export default defineConfig({
	root: "web",
	plugins: [solid()],
	resolve: { alias: { "~": web("src"), "styled-system": web("styled-system") } },
	css: { postcss: { plugins: [pandacss()] } },
	server: { port: 4778, proxy: { "/api": api, "/mcp": api } },
	build: { outDir: "dist", emptyOutDir: true },
});
