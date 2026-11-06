import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const run = promisify(execFile)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'refresh-screen-data',
      configureServer(server) {
        let refreshing = false

        server.middlewares.use('/api/refresh', async (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }
          if (refreshing) {
            res.statusCode = 409
            res.end('A refresh is already in progress')
            return
          }

          refreshing = true
          try {
            await run('npm', ['run', 'screen'], { cwd: process.cwd() })
            res.statusCode = 204
            res.end()
          } catch (error) {
            console.error('Screen refresh failed', error)
            res.statusCode = 500
            res.end('Screen refresh failed')
          } finally {
            refreshing = false
          }
        })
      },
    },
  ],
})
