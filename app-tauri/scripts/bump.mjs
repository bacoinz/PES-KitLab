// Bumps the patch version in package.json and src-tauri/Cargo.toml (every build gets a new number).
import { readFileSync, writeFileSync } from 'fs'
const pkgPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [a, b, c] = pkg.version.split('.').map(Number)
pkg.version = `${a}.${b}.${c + 1}`
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
const cargoPath = new URL('../src-tauri/Cargo.toml', import.meta.url)
writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(/^version = ".*"$/m, `version = "${pkg.version}"`))
console.log('version', pkg.version)
