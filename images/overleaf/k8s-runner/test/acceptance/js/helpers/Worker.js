import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const exec = promisify(execFile)
export const workerPath = path.resolve(import.meta.dirname, '../../../../worker.py')

export async function startWorker(root, workspace, idleSeconds = 600) {
  const env = { ...process.env, RUNNER_ACTIVITY: path.join(root, 'activity'),
    RUNNER_WORKSPACE: workspace, RUNNER_IDLE_SECONDS: String(idleSeconds),
    HOME: path.join(root, 'home') }
  const worker = spawn('python3', [workerPath, 'serve'], { env, stdio: 'ignore' })
  const exited = new Promise(resolve => worker.once('exit', resolve))
  const stop = async () => {
    if (worker.exitCode === null) worker.kill()
    await exited
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fs.stat(env.RUNNER_ACTIVITY).catch(() => null)) {
      return {
        env, process: worker, exited, stop,
        async invoke(command, timeoutSeconds = 2) {
          const request = { command, timeoutSeconds, environment: {}, cwd: '' }
          const result = exec('python3', [workerPath, 'invoke'], { env })
          result.child.stdin.end(JSON.stringify(request) + '\n')
          const { stdout } = await result
          return JSON.parse(stdout)
        },
        probe: () => exec('test', ['-f', env.RUNNER_ACTIVITY]),
      }
    }
    if (worker.exitCode !== null) break
    await sleep(20)
  }
  await stop()
  throw new Error('Test worker did not become ready')
}
