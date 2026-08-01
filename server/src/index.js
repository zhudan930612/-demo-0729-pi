import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app.js'
import { loadEnvFile, readServerConfig } from './config.js'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(path.join(serverDir, '.env.local'))
const config = readServerConfig()
const server = createAppServer(config)
server.listen(config.port, '127.0.0.1', () => {
  console.info({ event: 'server-started', host: '127.0.0.1', port: config.port, configured: Boolean(config.developerId && config.key) })
})

function shutdown() {
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
