import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api.php': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
});
