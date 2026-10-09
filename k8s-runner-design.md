# Kubernetes compile runner

CLSI selects a Kubernetes command backend while retaining upstream command
construction, cache handling, output publication, PDF optimisation and retry logic.
The adapter adjusts workspace paths and HTTP/lock timeouts.

## Lifecycle

Each project gets a reusable Job running the dedicated compiler image. Commands
serialize within a runner; projects never share runners. Idle expiry, an absolute
Job deadline and finished-Job TTL bound resource use. Restarts and Job retries are
disabled. Application restarts create new runners; old Jobs expire independently.
Kubernetes quotas control aggregate capacity; the application has no global queue
or runner ceiling and never evicts idle runners to admit another project. Normal
operation assumes sufficient quota. Capacity shortages follow the existing
request deadline.

Commands and transfers atomically replace a file containing their monotonic
expiry deadline. Completion restores the idle deadline; an abandoned operation's
lease expires independently. PID 1 polls this file and reaps exited children.
Readiness only checks for the file and never extends the runner's lifetime.

Healthy runners survive successful commands and ordinary compiler errors.
Cancellation, timeout, OOM and infrastructure loss discard the runner. Timeouts
collect available outputs within a bounded interval. Return CLSI's existing error
contract: `EPIPE` for infrastructure loss (including OOM), `terminated` for
cancellation and `timedout` for execution timeout. Upstream handles retries and
cancellation; the backend never falls back to local compilation.

## Workspace

CLSI's locked workspace and auxiliary cache remain on the application PVC.
Each invocation mirrors prepared inputs to `/compile`, executes the upstream
command and mirrors results back before CLSI publishes outputs. SyncTeX and
word-count operations copy inputs without returning workspace changes.

Rsync over non-TTY `kubectl exec` preserves permissions, nanosecond timestamps
and deletions. Checksums detect changed content even when size and timestamps
match; block deltas avoid resending unchanged data. Files are replaced atomically.
A failed transfer discards the runner and fails the attempt; upstream prepares
current inputs for a retry. Canonical project data remains in Overleaf's services.

## Isolation and validation

A dedicated compiler namespace contains tokenless pods with private `emptyDir`
storage, SCC-assigned UIDs, a read-only image, no capabilities or privilege
escalation, and denied network ingress/egress. The application uses the Kubernetes
API through kubectl to create/delete Jobs, list pods and exec commands, using its
mounted service-account credentials. CLI failures return `EPIPE`; compiler errors
remain distinct in the worker JSON response. Subprocess deadlines preserve
kubectl's automatic in-cluster authentication without REST-config overrides.
Deployment configuration fixes the compiler image and bounds storage and
operation lifetimes.

One request deadline covers waiting, startup, transfers and execution; the compiler
has its own execution timeout. Expired or cancelled requests stop their local
processes; best-effort Job deletion retains a bounded cleanup allowance.

Tests follow upstream's Vitest unit and Mocha/Chai acceptance structure, covering
lifecycle, exec/rsync transport and error handling. An optional compiler-image
smoke test checks arbitrary-UID execution, isolation and auxiliary-cache reuse.
