import { assert } from 'chai'
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { KubernetesRunner } from '../../../../KubernetesRunner.mjs'
import { clusterApi } from '../../../../KubernetesApi.mjs'
import { startWorker, workerPath } from './Worker.js'

// A loopback Kubernetes API/exec fixture: production kubectl and rsync run
// unchanged; only the cluster and pod process are substituted.
export async function createTransportFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-transport-'))
  const directory = path.join(root, 'source with spaces'), remote = path.join(root, 'remote')
  await fs.mkdir(directory); await fs.mkdir(remote)
  const worker = await startWorker(root, remote)
  const env = worker.env
  const children = new Set(), calls = [], transfers = []
  let name, interruptDownload = false, invoking, stall, stalled = false
  const invoked = new Promise(resolve => { invoking = resolve })
  const pod = () => ({ apiVersion: 'v1', kind: 'Pod',
    metadata: { name: name + '-pod', namespace: 'compiler' },
    spec: { containers: [{ name: 'compiler' }] },
    status: { phase: 'Running', containerStatuses: [{ name: 'compiler', ready: true }] } })
  const resources = (groupVersion, name, kind) => ({
    apiVersion: 'v1', kind: 'APIResourceList', groupVersion,
    resources: [{ name, kind, namespaced: true, singularName: name.slice(0, -1),
      verbs: ['get', 'list', 'create', 'delete'] }],
  })
  const server = http.createServer(async (req, res) => {
    calls.push(req.method + ' ' + req.url)
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, 'http://fixture')
    let result
    if (url.pathname === '/api') result = { apiVersion: 'v1', kind: 'APIVersions', versions: ['v1'] }
    else if (url.pathname === '/apis') result = { apiVersion: 'v1', kind: 'APIGroupList', groups: [{
      name: 'batch', versions: [{ groupVersion: 'batch/v1', version: 'v1' }],
      preferredVersion: { groupVersion: 'batch/v1', version: 'v1' },
    }] }
    else if (url.pathname === '/api/v1') result = resources('v1', 'pods', 'Pod')
    else if (url.pathname === '/apis/batch/v1') result = resources('batch/v1', 'jobs', 'Job')
    else if (req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      if (stall === 'create') { stalled = true; return }
      const job = JSON.parse(body)
      name = job.metadata.name
      res.statusCode = 201; result = job
    } else if (req.method === 'DELETE' && url.pathname.includes('/jobs/')) {
      result = { apiVersion: 'v1', kind: 'Status', status: 'Success' }
    } else if (url.pathname.endsWith('/pods')) result = { apiVersion: 'v1', kind: 'PodList', items: [pod()] }
    else if (url.pathname.endsWith('/pods/' + name + '-pod')) result = pod()
    else {
      res.statusCode = 404
      result = { apiVersion: 'v1', kind: 'Status', status: 'Failure', reason: 'NotFound', code: 404 }
    }
    res.end(JSON.stringify(result))
  })
  const wsServer = new WebSocketServer({ noServer: true, handleProtocols: () => 'v5.channel.k8s.io' })
  server.on('upgrade', (req, socket, head) => wsServer.handleUpgrade(req, socket, head, ws => {
    const args = new URL(req.url, 'http://fixture').searchParams.getAll('command')
    assert.strictEqual(args[0], 'python3')
    assert.strictEqual(args[1], '/opt/overleaf-runner/worker.py')
    if (args[2] === stall) { stalled = true; return }
    if (args.at(-1) === '/compile/') args[args.length - 1] = remote + '/'
    const child = spawn('python3', [workerPath, ...args.slice(2)], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    children.add(child)
    if (args[2] === 'invoke') invoking()
    const transfer = { sender: args.includes('--sender'), bytes: 0 }
    if (args[2] === 'rsync') transfers.push(transfer)
    child.stdout.on('data', data => {
      transfer.bytes += data.length
      if (transfer.sender && interruptDownload && transfer.bytes > 65536) {
        ws.terminate(); child.kill(); return
      }
      if (ws.readyState === 1) ws.send(Buffer.concat([Buffer.from([1]), data]))
    })
    child.stderr.on('data', data => {
      if (ws.readyState === 1) ws.send(Buffer.concat([Buffer.from([2]), data]))
    })
    child.once('close', code => {
      children.delete(child)
      if (ws.readyState === 1) ws.send(Buffer.concat([Buffer.from([3]),
        Buffer.from(JSON.stringify({ status: code === 0 ? 'Success' : 'Failure' }))]), () => ws.close(1000))
    })
    child.stdin.on('error', () => {})
    ws.on('message', data => {
      if (data[0] === 255) { child.stdin.end(); return }
      assert.strictEqual(data[0], 0)
      child.stdin.write(data.subarray(1))
    })
    ws.on('close', () => { if (child.exitCode === null) child.kill() })
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const close = async () => {
    await worker.stop()
    for (const child of children) child.kill()
    for (const ws of wsServer.clients) ws.terminate()
    wsServer.close(); server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
  const url = `http://127.0.0.1:${server.address().port}`
  const kubeconfig = path.join(root, 'kubeconfig')
  await fs.writeFile(kubeconfig, JSON.stringify({ apiVersion: 'v1', kind: 'Config',
    clusters: [{ name: 'fixture', cluster: { server: url } }],
    users: [{ name: 'fixture', user: { token: 'fixture-token' } }],
    contexts: [{ name: 'fixture', context: { cluster: 'fixture', user: 'fixture' } }],
    'current-context': 'fixture' }), { mode: 0o600 })
  const config = { namespace: 'compiler', image: 'fixed-image', owner: 'fixture',
    serviceAccount: 'fixture',
    requestTimeoutSeconds: 30,
    idleSeconds: 600, maxLifetimeSeconds: 3600,
    finishedTtlSeconds: 60, resources: {}, workspaceSize: '1Gi', temporarySize: '1Gi',
    imagePullSecrets: [], nodeSelector: {} }
  const api = clusterApi(config, { ...process.env, KUBECONFIG: kubeconfig, HOME: root })
  const runner = new KubernetesRunner(config, api)
  return {
    directory, remote, transfers, calls, close, runner, invoked,
    run: (command, group = 'standard') => runner.promises.run('project', command,
      directory, null, 1000, {}, group, null),
    interrupt() { interruptDownload = true },
    resume() { interruptDownload = false },
    stall(phase) { stall = phase },
    get stalled() { return stalled },
  }
}
