import { expect } from 'chai'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

const exec = promisify(execFile)
const suite = process.env.RUN_COMPILER_INTEGRATION === '1' ? describe : describe.skip
suite('Compiler image', function () {
  this.timeout(300000)
  let container
  after(async function () {
    if (container) await exec('docker', ['rm', '-f', container])
  })

  it('should compile as an arbitrary UID with isolated storage and reuse its auxiliary cache', async function () {
    const image = process.env.COMPILER_TEST_IMAGE || 'overleaf-compiler:development'
    const { stdout } = await exec('docker', ['run', '-d', '--platform', 'linux/amd64',
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '1008180000:0', '--memory', '2g', '--cpus', '2',
      '--tmpfs', '/tmp:rw,exec,mode=1777', '--tmpfs', '/work:rw,exec,mode=1777',
      '-e', 'RUNNER_IDLE_SECONDS=120', image])
    container = stdout.trim()
    const dockerExec = (...args) => exec('docker', ['exec', container, ...args])
    for (let attempt = 0; ; attempt++) {
      try {
        await dockerExec('test', '-f', '/tmp/overleaf-runner.activity')
        break
      } catch (error) {
        if (attempt === 99) throw error
        await sleep(100)
      }
    }
    await dockerExec('rsync', '--version')
    await dockerExec('python3', '-c', "import sys; from pathlib import Path; Path('/compile/main.tex').write_text(sys.argv[1])",
      String.raw`\documentclass{article}\begin{document}Runner round trip.\end{document}`)
    const run = async () => {
      const result = exec('docker', ['exec', '-i', container, 'python3', '/opt/overleaf-runner/worker.py', 'invoke'])
      result.child.stdin.end(JSON.stringify({ command: ['latexmk', '-pdf', '-interaction=nonstopmode',
        '-jobname=output', '-outdir=/compile', '/compile/main.tex'], timeoutSeconds: 180 }) + '\n')
      const { stdout } = await result
      return JSON.parse(stdout)
    }
    const first = await run()
    expect(first.exitCode, first.stdout + first.stderr).to.equal(0)
    await dockerExec('python3', '-c', "from pathlib import Path; assert Path('/compile/output.pdf').read_bytes().startswith(b'%PDF-'); assert Path('/compile/output.aux').stat().st_size > 0")
    const warm = await run()
    expect(warm.exitCode, warm.stdout + warm.stderr).to.equal(0)
    expect(warm.stdout + warm.stderr).to.match(/Nothing to do|up.to.date/i)
  })
})
