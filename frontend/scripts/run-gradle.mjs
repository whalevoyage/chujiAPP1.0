import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedTasks = new Set(['assembleDebug', 'assembleRelease'])
const task = process.argv[2]
if (!allowedTasks.has(task)) {
  throw new Error(`Unsupported Gradle task: ${task ?? '(missing)'}`)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const androidDirectory = resolve(scriptDirectory, '../android')
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const result = spawnSync(wrapper, [task], {
  cwd: androidDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)

