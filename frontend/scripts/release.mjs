// Empaqueta la aplicación lista para subir al servidor: release/finhub/ con el frontend compilado y la API al lado.
// Uso: npm run release (desde frontend/). Se ejecuta después de vite build.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'release', 'finhub')
const dist = join(root, 'frontend', 'dist')

if (!existsSync(dist)) {
  console.error('No existe frontend/dist: ejecuta antes vite build.')
  process.exit(1)
}

// Nunca se empaqueta la configuración de esta instalación
const excluded = new Set(['config.local.php'])

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(dist, out, { recursive: true })
cpSync(join(root, 'api'), join(out, 'api'), {
  recursive: true,
  filter: (src) => !excluded.has(basename(src)) && !src.endsWith('.tmp'),
})
for (const file of ['README.md', 'LICENSE']) {
  if (existsSync(join(root, file))) cpSync(join(root, file), join(out, file))
}

console.log(`Release lista en ${out}`)
