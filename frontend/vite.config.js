import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    // Rutas relativas: el build funciona en cualquier carpeta del servidor
    base: './',
    server: {
      proxy: {
        // En desarrollo, /api se reenvía a la API servida por Apache (WAMP, XAMPP...).
        // DEV_API_TARGET es la URL de la carpeta que contiene api/.
        '/api': { target: env.DEV_API_TARGET || 'http://localhost/finhub2.0', changeOrigin: true },
      },
    },
  }
})
