import { createExportService } from './export.mjs'

export function localExport() {
  function attach(server) {
    const http = server.httpServer
    if (!http) return
    const service = createExportService()
    server.middlewares.use((request, response, next) => {
      service.middleware(request, response, next, http.address())
    })
    const shutdown = () => {
      void service.close().finally(() => process.exit(0))
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    http.once('close', () => {
      process.removeListener('SIGINT', shutdown)
      process.removeListener('SIGTERM', shutdown)
      void service.close()
    })
  }
  return { name: 'viralcut-local-export', configureServer: attach, configurePreviewServer: attach }
}
