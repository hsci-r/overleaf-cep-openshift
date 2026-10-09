import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { syncWorkspace, stopChild } from './WorkspaceSync.mjs'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const unavailable = message => Object.assign(new Error(message), { code: 'EPIPE' })
const terminated = () => Object.assign(new Error('terminated'), { terminated: true })
function stop(op) {
  for (const child of op.children) stopChild(child)
}

export function jobManifest(config, name, projectId) {
  const labels = { 'app.kubernetes.io/component': 'compiler', 'overleaf.org/runner': config.owner,
    'overleaf.org/project': projectId.slice(0, 63) }
  return {
    apiVersion: 'batch/v1', kind: 'Job', metadata: { name, labels },
    spec: { backoffLimit: 0, activeDeadlineSeconds: config.maxLifetimeSeconds,
      ttlSecondsAfterFinished: config.finishedTtlSeconds,
      template: { metadata: { labels }, spec: {
        restartPolicy: 'Never', serviceAccountName: config.serviceAccount,
        automountServiceAccountToken: false, enableServiceLinks: false,
        terminationGracePeriodSeconds: 5, nodeSelector: config.nodeSelector,
        imagePullSecrets: config.imagePullSecrets,
        containers: [{ name: 'compiler', image: config.image, imagePullPolicy: 'Always',
          command: ['python3', '/opt/overleaf-runner/worker.py', 'serve'],
          env: [{ name: 'HOME', value: '/tmp/home' }, { name: 'CLSI', value: '1' },
            { name: 'RUNNER_IDLE_SECONDS', value: String(config.idleSeconds) }],
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true,
            runAsNonRoot: true, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
          resources: config.resources,
          readinessProbe: { exec: { command: ['test', '-f', '/tmp/overleaf-runner.activity'] },
            periodSeconds: 2, timeoutSeconds: 1 },
          volumeMounts: [{ name: 'workspace', mountPath: '/work' },
            { name: 'temporary', mountPath: '/tmp' }],
        }], volumes: [{ name: 'workspace', emptyDir: { sizeLimit: config.workspaceSize } },
          { name: 'temporary', emptyDir: { sizeLimit: config.temporarySize } }],
      } },
    },
  }
}

export class KubernetesRunner {
  constructor(config, api) {
    this.config = config
    this.api = api
    this.runners = new Map()
    this.operations = new Map()
    this.run = this.run.bind(this)
    this.kill = this.kill.bind(this)
    this.promises = { run: promisify(this.run), kill: promisify(this.kill) }
  }

  run(projectId, command, directory, image, timeout, environment, compileGroup, cwd, callback) {
    const id = randomUUID()
    const op = { cancelled: false, runner: null, children: [],
      deadline: Date.now() + this.config.requestTimeoutSeconds * 1000,
      track(child) {
        this.children.push(child)
        if (this.cancelled || Date.now() >= this.deadline) stopChild(child)
      } }
    this.operations.set(id, op)
    this.execute(op, projectId, command, directory, timeout, environment, compileGroup, cwd)
      .finally(() => { this.operations.delete(id) })
      .then(result => callback(null, result), error => callback(error, error.output))
    return id
  }

  check(op) {
    if (op.cancelled) throw terminated()
    if (Date.now() >= op.deadline) throw unavailable('Runner request deadline exceeded')
  }

  async discard(runner, forget = true, op) {
    await this.api.remove(runner.name, op)
    if (forget && this.runners.get(runner.key) === runner) this.runners.delete(runner.key)
  }

  async acquire(op, key) {
    while (this.runners.get(key)?.busy) {
      this.check(op)
      await sleep(100)
    }
    this.check(op)
    let runner = this.runners.get(key)
    if (!runner) {
      runner = { key, name: `ol-${randomUUID()}`, created: false, pod: null }
      this.runners.set(key, runner)
    }
    runner.busy = true
    op.runner = runner
    return runner
  }

  async ready(op, runner) {
    if (runner.created) {
      const pods = await this.api.pods(runner.name, op)
      const pod = pods.items.find(p => p.metadata.name === runner.pod)
      if (pod?.status?.phase === 'Running' && pod.status.containerStatuses?.[0]?.ready) return
      // Hold this project's slot throughout replacement. Other commands must
      // not start a second pod while deletion of the old Job is in flight.
      await this.discard(runner, false, op)
      runner.name = `ol-${randomUUID()}`
      runner.pod = null
      runner.created = false
    }
    this.check(op)
    await this.api.create(jobManifest(this.config, runner.name, runner.key), op)
    runner.created = true
    while (true) {
      this.check(op)
      const pods = await this.api.pods(runner.name, op)
      for (const pod of pods.items) {
        const status = pod.status?.containerStatuses?.[0]
        if (status?.state?.terminated || pod.status?.phase === 'Failed') {
          throw unavailable(status?.state?.terminated?.reason || 'Compiler pod failed')
        }
        if (pod.status?.phase === 'Running' && status?.ready) {
          runner.pod = pod.metadata.name
          return
        }
      }
      await sleep(500)
    }
  }

  async roundTrip(op, runner, request, directory) {
    try {
      await syncWorkspace(this.config, this.api, op, runner.pod, directory)
      this.check(op)
      const response = await this.api.exec(runner.pod,
        ['python3', '/opt/overleaf-runner/worker.py', 'invoke'],
        JSON.stringify(request) + '\n',
        op)
      this.check(op)
      const result = JSON.parse(response)
      if (!request.readOnly) await syncWorkspace(this.config, this.api, op, runner.pod, directory, true)
      return result
    } catch (error) {
      this.check(op)
      throw unavailable(error.message)
    }
  }

  async execute(op, projectId, command, directory, timeout, environment, compileGroup, cwd) {
    // The deployment selects one compiler image. Upstream's image argument
    // (including helper-image names) never selects a different pod image.
    const readOnly = ['synctex', 'synctex-output', 'wordcount'].includes(compileGroup)
    let runner
    const deadline = setTimeout(() => stop(op), Math.max(1, op.deadline - Date.now()))
    try {
      // CLSI appends a user id for its independent per-user caches. Reuse one
      // project pod while mirroring each caller's separately locked workspace.
      const key = projectId.match(/^([a-f0-9]{24})(?:-[a-f0-9]{24})?$/)?.[1] || projectId
      runner = await this.acquire(op, key)
      await this.ready(op, runner)
      const request = {
        command: command.map(arg => String(arg).replaceAll('$COMPILE_DIR', '/compile')),
        cwd: cwd || '', environment, readOnly,
        timeoutSeconds: timeout / 1000,
      }
      const output = await this.roundTrip(op, runner, request, directory)
      if (output.timedout) throw Object.assign(new Error('Compiler timed out'), { timedout: true, output })
      if (output.exitCode === 137 || output.exitCode < 0) {
        throw Object.assign(unavailable('Compiler process was killed'), { output })
      }
      if (output.exitCode === 1) throw Object.assign(new Error('exited'), { code: 1, output })
      return output
    } catch (error) {
      if (runner && (op.cancelled || error.code !== 1)) {
        await this.discard(runner).catch(() => {})
      }
      if (op.cancelled) throw terminated()
      throw error
    } finally {
      clearTimeout(deadline)
      if (runner) runner.busy = false
    }
  }

  kill(id, callback = () => {}) {
    const op = this.operations.get(id)
    if (!op) { callback(); return }
    op.cancelled = true
    stop(op)
    // Creation may still be in flight; execute() checks cancellation after it
    // returns and also deletes the Job before invoking its callback.
    Promise.resolve(op.runner?.created ? this.discard(op.runner) : null).then(() => callback(), callback)
  }

  canRunSyncTeXInOutputDir() { return true }
}
