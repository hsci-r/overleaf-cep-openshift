import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KubernetesRunner } from '../../../KubernetesRunner.mjs'

const config = {
  namespace: 'compilers', image: 'example/texlive:fixed', owner: 'overleaf',
  serviceAccount: 'compiler',
  requestTimeoutSeconds: 2, idleSeconds: 600, maxLifetimeSeconds: 21600,
  finishedTtlSeconds: 60, workspaceSize: '1Gi',
  temporarySize: '512Mi', resources: {}, nodeSelector: {}, imagePullSecrets: [],
}

describe('KubernetesRunner', () => {
  beforeEach(ctx => {
    ctx.api = {
      create: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      pods: vi.fn(async name => ({ items: [{ metadata: { name: name + '-pod' },
        status: { phase: 'Running', containerStatuses: [{ ready: true }] } }] })),
    }
    ctx.runner = new KubernetesRunner(config, ctx.api)
    vi.spyOn(ctx.runner, 'roundTrip').mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    ctx.run = (project = 'project') => ctx.runner.promises.run(project,
      ['latexmk', '$COMPILE_DIR/main.tex'], '/local/workspace', 'request-image', 1000, {}, 'standard', null)
  })

  describe('reuse and replacement', () => {
    it('should reuse a pod across per-user caches and give other projects their own pod', async ctx => {
      const project = '0123456789abcdef01234567'
      await ctx.run(`${project}-111111111111111111111111`)
      await ctx.run(`${project}-222222222222222222222222`)
      expect(ctx.api.create).toHaveBeenCalledTimes(1)
      await ctx.run('333333333333333333333333')
      expect(ctx.api.create).toHaveBeenCalledTimes(2)
    })

    it('should replace an expired runner while retaining its project slot', async ctx => {
      await ctx.run()
      const first = ctx.api.create.mock.calls[0][0].metadata.name
      ctx.api.pods.mockResolvedValueOnce({ items: [] })
      let release, deleting
      const started = new Promise(resolve => { deleting = resolve })
      ctx.api.remove.mockImplementation(async () => {
        deleting()
        await new Promise(resolve => { release = resolve })
      })
      const replacing = ctx.run()
      await started
      // Observe the second acquisition before releasing deletion, without a
      // wall-clock sleep or asserting the runner's internal map layout.
      const acquire = ctx.runner.acquire.bind(ctx.runner)
      let queued
      const entered = new Promise(resolve => { queued = resolve })
      vi.spyOn(ctx.runner, 'acquire').mockImplementation((...args) => {
        const result = acquire(...args)
        queued()
        return result
      })
      const waiting = ctx.run()
      await entered
      expect(ctx.api.create).toHaveBeenCalledTimes(1)
      release()
      await Promise.all([replacing, waiting])
      expect(ctx.api.remove.mock.calls[0][0]).toBe(first)
      expect(ctx.api.create).toHaveBeenCalledTimes(2)
      expect(ctx.api.create.mock.calls[1][0].metadata.name).not.toBe(first)
    })
  })

  describe('failure and cancellation', () => {
    it('should remove a Job whose creation completes after cancellation', async ctx => {
      let resume, creating
      const started = new Promise(resolve => { creating = resolve })
      ctx.api.create.mockImplementation(async () => {
        creating()
        await new Promise(resolve => { resume = resolve })
      })
      let id
      const result = new Promise(resolve => {
        id = ctx.runner.run('project', ['latexmk'], '/workspace', undefined, 1000, {},
          'standard', null, error => resolve(error))
      })
      await started
      await ctx.runner.promises.kill(id)
      resume()
      expect(await result).toMatchObject({ terminated: true })
      expect(ctx.runner.roundTrip).not.toHaveBeenCalled()
      expect(ctx.api.remove.mock.calls[0][0]).toBe(ctx.api.create.mock.calls[0][0].metadata.name)
    })

    it('should retain a runner after a TeX error but discard it after timeout or process loss', async ctx => {
      ctx.runner.roundTrip.mockResolvedValueOnce({ stdout: 'error', exitCode: 1 })
      await expect(ctx.run()).rejects.toMatchObject({ code: 1 })
      expect(ctx.api.remove).not.toHaveBeenCalled()
      ctx.runner.roundTrip.mockResolvedValueOnce({ stdout: 'partial', timedout: true })
      await expect(ctx.run()).rejects.toMatchObject({ timedout: true, output: { stdout: 'partial' } })
      expect(ctx.api.remove).toHaveBeenCalledTimes(1)
      ctx.runner.roundTrip.mockResolvedValueOnce({ stdout: 'partial', exitCode: 137 })
      await expect(ctx.run()).rejects.toMatchObject({ code: 'EPIPE', output: { stdout: 'partial' } })
      expect(ctx.api.remove).toHaveBeenCalledTimes(2)
    })
  })
})
