import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '../..')
const version = readFileSync(resolve(rootDirectory, 'VERSION'), 'utf8').trim()
const frontendPackage = JSON.parse(readFileSync(resolve(rootDirectory, 'frontend/package.json'), 'utf8'))
const androidBuild = readFileSync(resolve(rootDirectory, 'frontend/android/app/build.gradle'), 'utf8')
const pwaConfig = readFileSync(resolve(rootDirectory, 'frontend/vite.config.ts'), 'utf8')

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION must be semantic version x.y.z; got ${version}`)
if (frontendPackage.version !== version) throw new Error(`frontend/package.json version ${frontendPackage.version} differs from VERSION ${version}`)
if (!androidBuild.includes("new File(rootProject.projectDir, '../../VERSION')")) throw new Error('Android versionName must read the root VERSION file')
if (!pwaConfig.includes('version: APP_VERSION')) throw new Error('PWA manifest must read the root VERSION file')

process.stdout.write(`Version metadata is consistent: ${version}\n`)
