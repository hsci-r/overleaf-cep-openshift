import { spawn } from 'node:child_process'
import { stopChild } from './WorkspaceSync.mjs'

// kubectl owns authentication, API discovery and the exec streaming protocol.
// Only worker JSON responses are buffered here; rsync streams directly via rsh.
export function clusterApi(config, env = process.env) {
  async function run(args, input, op) {
    const child = spawn('kubectl', ['--namespace', config.namespace, ...args], {
      env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    op?.track(child)
    let output = '', diagnostic = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(0, 8192) })
    // The remote process can exit before accepting all input.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    // Cleanup must still be bounded after the request deadline or cancellation.
    const timer = op ? null : setTimeout(() => stopChild(child), 15000)
    try {
      return await new Promise((resolve, reject) => {
        const fail = error => reject(Object.assign(new Error(diagnostic || error.message), {
          code: 'EPIPE', cause: error,
        }))
        child.once('error', fail)
        child.once('close', (code, signal) => code === 0 ? resolve(output) :
          fail(new Error(`kubectl exited ${signal || code}`)))
      })
    } finally { clearTimeout(timer) }
  }

  return {
    rsyncEnv: env,
    create: (body, op) => run(['create', '--validate=false', '-f', '-'], JSON.stringify(body), op),
    remove: (name, op) => run(['delete', 'job', name,
      '--cascade=foreground', '--wait=false', '--ignore-not-found=true'], undefined, op),
    pods: async (name, op) => JSON.parse(await run(['get', 'pods',
      '--selector', `job-name=${name}`, '-o', 'json'], undefined, op)),
    exec: (pod, command, input, op) => run(['exec', '-i', pod, '-c', 'compiler', '--',
      ...command], input, op),
  }
}
