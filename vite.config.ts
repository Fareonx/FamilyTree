/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base works for GitHub Pages (/<repo>/) and any other static host.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
