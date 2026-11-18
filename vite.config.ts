import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute asset paths: Hub is served from the site root, and pages like /contacts/:id must load
  // /assets/… rather than /contacts/assets/… when opened directly.
  base: '/',
  plugins: [react()],
  server: { port: 5173 },
});
