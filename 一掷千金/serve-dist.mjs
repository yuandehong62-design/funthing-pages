// Minimal static file server for the web edition (no dependencies).
// Serves the public build on http://localhost:8017 and opens the default browser.
// Pure ASCII - keep it that way (shared with start-web.bat).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'

const PORT = 8017
// The web root is resolved in this order:
//   1. <cwd>/builds/public - "npm run start:web" from repo root
//   2. <script dir>        - standalone package layout (builds/web/):
//                            the launcher and the web files sit side by side
// normalize keeps a trailing separator on Windows - strip it for the prefix check below
const here = fileURLToPath(new URL('.', import.meta.url))
const cwd = process.cwd()
const rootDir = normalize(
  existsSync(join(cwd, 'builds', 'public', 'index.html'))
    ? join(cwd, 'builds', 'public')
    : here,
).replace(/[\\/]+$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
}

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (p === '/') p = '/index.html'
    // Prevent path traversal outside the web root
    const file = normalize(join(rootDir, p))
    if (file !== rootDir && !file.startsWith(rootDir + sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`
  console.log(`[web] Serving ${rootDir} at ${url}`)
  console.log('[web] Press Ctrl+C to stop.')
  // Open default browser (Windows "start" is a cmd builtin)
  exec(`start "" "${url}"`)
})
