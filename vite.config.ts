import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    tailwindcss()
  ],
  server: {
    host: '127.0.0.1' // matching your dev script
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
});