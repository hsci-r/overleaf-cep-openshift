# Configuration

See [values.yaml](../charts/overleaf-openshift/values.yaml) for deployment settings.
Application features use upstream [CE+](https://github.com/yu-i-i/overleaf-cep/wiki/Extended-CE:-Environment-Variables)
and [Overleaf](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/environment-variables)
variables in `extraEnv`; credentials belong in Secrets via `extraEnvFrom`.
The chart manages service addresses, credentials, backend selection and
compile/upload/proxy limits.

```yaml
extraEnv:
  OVERLEAF_ENABLE_REGISTRATION_PAGE: "true"
  OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS: example.org
  OVERLEAF_EMAIL_SMTP_HOST: smtp.example.org
  OVERLEAF_EMAIL_SMTP_PORT: "587"
  OVERLEAF_EMAIL_FROM_ADDRESS: overleaf@example.org
extraEnvFrom:
  - secretRef:
      name: overleaf-smtp # OVERLEAF_EMAIL_SMTP_USER / OVERLEAF_EMAIL_SMTP_PASS
```

External linked files and permanent resource deletion are opt-in through
`ENABLED_LINKED_FILE_TYPES` and `ENABLE_CRON_RESOURCE_DELETION`.

## Git bridge

Enabled by default in the application pod with a separate retained PVC. Set
`gitBridge.enabled: false` to disable it. Match `gitBridge.image` to the application's
underlying CE release; use `gitBridge.extraEnv` for upstream bridge settings.
File-size limits follow `uploads.maxSizeMB`. GitHub sync is configured separately
through upstream variables.

## Isolated Kubernetes compiles

Create a dedicated compiler namespace. The installing identity must be able to
manage its ServiceAccounts, Roles, RoleBindings and NetworkPolicies. Keep it free
of application Secrets and PVCs; remove default network allow policies, which
would override the chart's isolation.

```yaml
compilation:
  backend: kubernetes
  kubernetes:
    namespace: overleaf-compiles
```

Each project uses a reusable, network-isolated runner. Provision quota for runner
limits plus temporary overlap after application restarts. Each runner defaults to
limits of 1.5 CPU, 8 GiB RAM and 2 GiB ephemeral storage.

Kubernetes quotas control aggregate capacity; the application only serializes
commands for the same project. `requestTimeoutSeconds` covers waiting, startup,
transfers and execution; `compilation.timeoutSeconds` separately limits the compiler.
Configure storage, idle expiry and Job lifetime under `compilation.kubernetes`.
Keep nginx and Route timeouts above `requestTimeoutSeconds`.
See the [runner design](../k8s-runner-design.md).

## Development

`make check` requires Node.js, Python 3, Helm, kubectl and rsync, and runs Helm lint,
Vitest unit tests and Mocha/Chai acceptance tests.
`make check-integration` builds and smoke-tests the isolated compiler image.

```sh
make image image-full image-compiler IMAGE_REPOSITORY=docker.io/YOUR_ACCOUNT/overleaf-cep-openshift
make push push-full push-compiler IMAGE_REPOSITORY=docker.io/YOUR_ACCOUNT/overleaf-cep-openshift
```

Application builds select the newest published CE+ release; override with
`OVERLEAF_BASE_IMAGE`. The compiler uses `texlive/texlive:latest-full`.
The application image includes kubectl from the latest patch of Kubernetes 1.35;
override the Docker build argument `KUBECTL_MINOR` for another server version.
Keep the client within one minor release of the Kubernetes server.
GitHub Actions publishes weekly, on manual dispatch or `image-*` tags after checks
pass. Set the Actions variable `DOCKERHUB_USERNAME` and Secret `DOCKERHUB_TOKEN`;
`DOCKERHUB_IMAGE` overrides the repository. `image-TAG` publishes `TAG`, `TAG-full`
and `TAG-compiler`.
