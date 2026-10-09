import { expect } from 'chai'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { startWorker, workerPath } from './helpers/Worker.js'

describe('Kubernetes compiler worker', function () {
  beforeEach(async function () {
    this.root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-worker-'))
    this.workspace = path.join(this.root, 'workspace')
    await fs.mkdir(this.workspace)
  })

  afterEach(async function () {
    await this.worker?.stop()
    await fs.rm(this.root, { recursive: true, force: true })
  })

  it('should retain timeout artifacts for collection before the app disposes the pod', async function () {
    this.worker = await startWorker(this.root, this.workspace)
    const result = await this.worker.invoke(['python3', '-c',
      "import time; from pathlib import Path; Path('output.log').write_text('partial'); time.sleep(10)"], 1)
    expect(result.timedout).to.equal(true)
    expect(await fs.readFile(path.join(this.workspace, 'output.log'), 'utf8')).to.equal('partial')
  })

  it('should stay alive while busy, then expire despite continued readiness probes', async function () {
    this.worker = await startWorker(this.root, this.workspace, 1)
    const result = await this.worker.invoke(['python3', '-c', 'import time; time.sleep(1.5)'])
    expect(result.exitCode).to.equal(0)
    while (this.worker.process.exitCode === null) {
      await this.worker.probe().catch(() => {})
      await sleep(20)
    }
    expect(await this.worker.exited).to.equal(0)
  })

  it('should expire an abandoned transfer lease without a completion notification', async function () {
    this.worker = await startWorker(this.root, this.workspace, 1)
    const file = this.worker.env.RUNNER_ACTIVITY
    const initial = await fs.readFile(file, 'utf8')
    const wrapper = spawn('python3', [workerPath, 'rsync', '3', '--server', '--sender',
      '-r', '.', this.workspace + '/'], { env: this.worker.env, detached: true,
      stdio: ['pipe', 'ignore', 'ignore'] })
    const exited = new Promise(resolve => wrapper.once('close', resolve))
    try {
      for (let attempt = 0; await fs.readFile(file, 'utf8') === initial; attempt++) {
        expect(attempt).to.be.below(100)
        await sleep(20)
      }
      process.kill(-wrapper.pid, 'SIGKILL')
      await exited
      const stopped = performance.now()
      expect(await this.worker.exited).to.equal(0)
      expect(performance.now() - stopped).to.be.above(1500)
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) {
        process.kill(-wrapper.pid, 'SIGKILL')
      }
      await exited
    }
  })
})
