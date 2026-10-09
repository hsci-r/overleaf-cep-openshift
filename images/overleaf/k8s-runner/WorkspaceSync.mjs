import path from 'node:path'
import { spawn } from 'node:child_process'

const adapter = path.join(import.meta.dirname, 'rsync-rsh.sh')

export function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { process.kill(-child.pid, 'SIGTERM') }
  catch { child.kill() }
}

export async function syncWorkspace(config, api, op, pod, directory, download = false) {
  const rsh = ['sh', adapter]
  // Rsync tokenizes --rsh itself, without invoking a shell. Quote each argument
  // for paths containing spaces; Kubernetes receives a command argument array.
  const shell = rsh.map(arg => '"' + arg.replaceAll('"', '""') + '"').join(' ')
  const args = ['--recursive', '--times', '--perms', '--checksum', '--modify-window=-1',
    '--delete-delay', '--chmod=Dug=rwx,Do=,Fug=rwX,Fo=', '--blocking-io', '--rsh=' + shell]
  args.push('--', ...(download ? [`${pod}:/compile/`, directory + '/'] : [directory + '/', `${pod}:/compile/`]))
  const child = spawn('rsync', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ...api.rsyncEnv, RUNNER_NAMESPACE: config.namespace,
      RUNNER_REQUEST_TIMEOUT_SECONDS: String(Math.max(0.001, (op.deadline - Date.now()) / 1000)) } })
  op.track(child)
  let diagnostic = ''
  child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(0, 8192) })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(diagnostic || `Rsync exited ${code}`)))
  })
  if (op.cancelled || Date.now() >= op.deadline) throw new Error('Workspace sync cancelled or expired')
}
