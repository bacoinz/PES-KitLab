// Copies the release exe to dist-portable/PES-KitLab-<version>-portable.exe (data lives next to it in KitCreatorData)
// and deletes the earlier versions' exes (only the newest stays).
import { readFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'fs'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const out = new URL('../dist-portable/', import.meta.url)
mkdirSync(out, { recursive: true })
const name = `PES-KitLab-${pkg.version}-portable.exe`
for (const f of readdirSync(out)) {
  if (f !== name && /^PES-Kit-?(Creator|Lab)-.*-portable\.exe$/i.test(f)) { try { unlinkSync(new URL(f, out)); console.log('removed', f) } catch (e) { console.log('could not remove', f, String(e)) } }
}
const dst = new URL(name, out)
copyFileSync(new URL('../src-tauri/target/release/pes-kit-creator.exe', import.meta.url), dst)
console.log('->', decodeURIComponent(dst.pathname.slice(1)))
