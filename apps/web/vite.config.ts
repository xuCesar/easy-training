import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3001,
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("/packages/ui/")) return "ui";
					if (!id.includes("node_modules")) return;
					if (id.includes("/react/") || id.includes("/react-dom/")) {
						return "react-vendor";
					}
					if (id.includes("/@tanstack/")) return "tanstack";
					if (id.includes("/@easy-training/ui/")) return "ui";
					if (id.includes("/@orpc/")) return "orpc";
					return "vendor";
				},
			},
		},
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		tailwindcss(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
	],
});
