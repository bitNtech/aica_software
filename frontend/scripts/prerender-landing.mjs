/* Stamps the server-rendered landing page into dist/index.html, so the first
   paint — and every crawler that does not run JS — gets the whole page, not an
   empty #root. Runs after both builds; see package.json. The console's shell
   (dist/app.html) is left alone: it is a client-only app. */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// A file:// URL, not a path: Node's import() rejects `C:\…` paths on Windows.
const { render } = await import(new URL('../dist-ssr/entry-server.js', import.meta.url).href)
const file = `${root}dist/index.html`
const html = readFileSync(file, 'utf8')
if (!html.includes('<!--app-->')) throw new Error('dist/index.html has no <!--app--> marker')
writeFileSync(file, html.replace('<!--app-->', render()))
rmSync(`${root}dist-ssr`, { recursive: true, force: true })
console.log('prerendered dist/index.html')
