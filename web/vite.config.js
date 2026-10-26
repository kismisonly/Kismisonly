import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relatif supaya jalan di root domain (Vercel/Netlify) maupun subpath (GitHub Pages).
export default defineConfig({ base: "./", plugins: [react()] });
