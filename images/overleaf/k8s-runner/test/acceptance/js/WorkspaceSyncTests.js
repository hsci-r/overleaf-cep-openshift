import { expect } from 'chai'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTransportFixture } from './helpers/KubernetesApi.js'

describe('Kubernetes workspace sync', function () {
  beforeEach(async function () {
    this.fixture = await createTransportFixture()
    this.source = path.join(this.fixture.directory, 'main.tex')
    await fs.writeFile(this.source, 'source')
  })

  afterEach(async function () {
    await this.fixture?.close()
  })

  it('should round-trip cache and deltas through exec while preserving timestamps and deletions', async function () {
    const f = this.fixture
    const asset = path.join(f.directory, 'large.bin')
    await fs.writeFile(asset, randomBytes(4 * 1024 * 1024))
    await f.run(['python3', '-c', "from pathlib import Path; Path('output.aux').write_text('cache')"])
    expect(await fs.readFile(path.join(f.directory, 'output.aux'), 'utf8')).to.equal('cache')
    const before = await fs.stat(asset, { bigint: true })
    f.transfers.length = 0
    await f.run(['true'])
    const after = await fs.stat(asset, { bigint: true })
    expect(after.ino).to.equal(before.ino)
    expect(after.mtimeNs).to.equal(before.mtimeNs)
    expect(f.transfers.every(transfer => transfer.bytes < 10000)).to.equal(true)
    const info = await fs.stat(this.source)
    await fs.writeFile(this.source, 'LATEST')
    await fs.utimes(this.source, info.atime, info.mtime)
    await fs.writeFile(path.join(f.remote, 'obsolete.aux'), 'remove')
    f.transfers.length = 0
    await f.run(['python3', '-c', "from pathlib import Path; assert Path('main.tex').read_text() == 'LATEST'; assert not Path('obsolete.aux').exists(); p=Path('large.bin'); b=bytearray(p.read_bytes()); b[12345]^=1; p.write_bytes(b); Path('output.aux').unlink()"])
    expect(await fs.stat(path.join(f.directory, 'output.aux')).catch(() => null)).to.equal(null)
    expect(f.transfers.find(transfer => transfer.sender).bytes).to.be.below(100000)
    expect(await fs.readFile(this.source, 'utf8')).to.equal('LATEST')
  })

  it('should discard a lost return and rebuild from fresh inputs on a replacement runner', async function () {
    const f = this.fixture
    f.interrupt()
    const error = await f.run(['python3', '-c', "import os; from pathlib import Path; Path('large.bin').write_bytes(os.urandom(4*1024*1024)); Path('output.aux').write_text('new cache')"]).catch(error => error)
    expect(error).to.have.property('code', 'EPIPE')
    expect(f.calls.filter(call => call.startsWith('DELETE /apis/batch/'))).to.have.length(1)
    f.resume()
    await fs.writeFile(this.source, 'latest editor state')
    await f.run(['python3', '-c', "from pathlib import Path; assert Path('main.tex').read_text() == 'latest editor state'; Path('output.aux').write_text('rebuilt')"])
    expect(await fs.readFile(path.join(f.directory, 'output.aux'), 'utf8')).to.equal('rebuilt')
    expect(f.calls.filter(call => call.startsWith('POST /apis/batch/'))).to.have.length(2)
  })

  it('should mirror read-only helper inputs without returning modified runner files', async function () {
    const f = this.fixture
    await fs.writeFile(path.join(f.directory, 'output.aux'), 'preserve')
    await f.run(['python3', '-c', "from pathlib import Path; assert Path('main.tex').read_text() == 'source'; Path('output.aux').write_text('runner only')"], 'synctex-output')
    expect(await fs.readFile(path.join(f.directory, 'output.aux'), 'utf8')).to.equal('preserve')
    expect(await fs.readFile(path.join(f.remote, 'output.aux'), 'utf8')).to.equal('runner only')
    expect(f.transfers.some(transfer => transfer.sender)).to.equal(false)
  })

  it('should cancel an active kubectl exec and discard its Job promptly', async function () {
    const f = this.fixture
    let id
    const result = new Promise(resolve => {
      id = f.runner.run('project', ['python3', '-c', 'import time; time.sleep(30)'],
        f.directory, null, 30000, {}, 'standard', null, error => resolve(error))
    })
    await f.invoked
    await f.runner.promises.kill(id)
    expect(await result).to.have.property('terminated', true)
    expect(f.calls.filter(call => call.startsWith('DELETE /apis/batch/'))).not.to.be.empty
  })

  for (const phase of ['create', 'rsync']) {
    it(`should stop stalled ${phase} at the request deadline and discard the Job`, async function () {
      this.timeout(10000)
      const f = this.fixture
      f.runner.config.requestTimeoutSeconds = 2
      f.stall(phase)
      const error = await f.run(['true']).catch(error => error)
      expect(f.stalled).to.equal(true)
      expect(error).to.have.property('code', 'EPIPE')
      expect(f.calls.filter(call => call.startsWith('DELETE /apis/batch/'))).not.to.be.empty
    })
  }
})
