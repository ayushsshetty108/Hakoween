import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pythonVenv = process.platform === 'win32'
  ? path.join(root, '.venv', 'Scripts', 'python.exe')
  : path.join(root, '.venv', 'bin', 'python')
const python = process.env.PYTHON || (existsSync(pythonVenv) ? pythonVenv : 'python')
const npmCli = process.env.npm_execpath
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
const npmArgs = npmCli
  ? [npmCli, 'run', 'dev']
  : process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev']
    : ['run', 'dev']
const children = [
  spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--reload', '--reload-dir', 'backend', '--reload-dir', 'src', '--port', '8000'], {
    cwd: root,
    stdio: 'inherit',
  }),
  spawn(npmCli ? process.execPath : npmCommand, npmArgs, {
    cwd: path.join(root, 'frontend'),
    stdio: 'inherit',
  }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill()
  process.exitCode = code
}

for (const child of children) {
  child.on('error', error => {
    console.error(`Unable to start ${child.spawnargs?.[0] || 'development service'}: ${error.message}`)
    stop(1)
  })
  child.on('exit', code => {
    if (!stopping) stop(code || 0)
  })
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
