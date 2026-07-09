import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.TEST_HARNESS': JSON.stringify(process.env.TEST_HARNESS || 'false'),
    'process.env.APP_BUILD_PROFILE': JSON.stringify(process.env.APP_BUILD_PROFILE || 'emulator'),
  }
})
