import { serve } from '@hono/node-server'
import { resolve } from 'node:path'

for (const name of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(resolve(process.cwd(), name))
  } catch {
    /* optional */
  }
}

const { app } = await import('./app')

const port = Number(process.env.API_PORT || 8787)
serve({ fetch: app.fetch, port }, () => {
  console.log(`mogger api http://localhost:${port}`)
})


