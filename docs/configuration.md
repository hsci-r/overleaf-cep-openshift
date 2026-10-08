# Configuration

The complete defaults are in [values.yaml](../charts/overleaf-openshift/values.yaml).
The chart validates values and renders upstream environment variables. Use
`extraEnv` for less common options and `extraEnvFrom` for additional Secrets.
Do not repeat a chart-managed setting in `extraEnv`.

| Values | Purpose |
| --- | --- |
| `registration.enabled`, `allowedEmailDomains` | Self-signup with emailed activation links. Domains are exact matches; `*.example.org` permits subdomains, excluding the base domain. An empty list permits every domain. Requires working SMTP. |
| `compilation.timeoutSeconds`, `requestSizeMB`, `defaultCompiler` | Compile allowance (maximum 600 seconds), source request size, and default compiler for new projects. Both compile body limits are kept aligned. Existing users keep their stored compile allowance. |
| `uploads.maxSizeMB`, `timeoutSeconds` | File/project upload size and processing timeout; the image applies the matching nginx body-size limit. |
| `nginx.proxyTimeoutSeconds`, `keepaliveTimeoutSeconds`, `workerConnections`, `workerProcesses` | Internal proxy behavior. Set the Route timeout annotation to at least the internal proxy timeout. The compile timeout must be smaller. |
| `features.historyRestore` | Experimental restore from project history. For older projects, see the migration below. |
| `features.pandocConversions` | Experimental Word/Markdown import and document export; Pandoc and zip are included in the image. |
| `features.chat`, `linkedFilesFromUrl` | Project chat and files linked from external URLs. |
| `templateGallery.enabled`, `categories`, `labels` | Template gallery, category keys, display names and descriptions. `all` is added automatically. |
| `templateGallery.nonAdminCanPublish`, `managerUserId` | Who can publish/manage templates. The manager is a non-admin MongoDB user ID. |
| `sharing.publicAccess`, `anonymousReadWrite`, `linkSharing`, `restrictInvitesToExistingAccounts` | Visibility, sharing links and invitations. |
| `retention.automaticDeletion`, `deletedUsersDays`, `deletedProjectsDays` | Permanent cleanup of soft-deleted users/projects. Automatic deletion is off by default. |
| `smtp.host`, `port`, `secure`, `verifyCertificate`, `ignoreStartTLS`, `sender`, `replyTo`, `name` | SMTP server and sender. Port 25/587 normally uses `secure: false` with opportunistic STARTTLS and certificate checks. |
| `smtp.existingSecret` | SMTP credentials in `OVERLEAF_EMAIL_SMTP_USER` and `OVERLEAF_EMAIL_SMTP_PASS`. |
| `authentication.methods`, `settings`, `existingSecret` | CE+ LDAP, SAML and OIDC; simultaneous methods are supported. Use upstream environment names in `settings`; keep provider credentials/private keys in the Secret. |
| `integrations.githubSync.enabled`, `clientId` | GitHub project synchronization; needs a GitHub OAuth application. |
| `integrations.zotero.enabled`, `clientKey` | Zotero linked bibliography files; needs a Zotero OAuth application. |
| `integrations.existingSecret` | `GITHUB_SYNC_CLIENT_SECRET`, `ZOTERO_CLIENT_SECRET`, and optionally persistent `TOKEN_CIPHER_PASSWORD`. Otherwise CE+ keeps its token cipher in the application PVC. Preserve it in backups. |
| `resources`, `mongodb`, `redis`, `persistence` | CPU/memory, database cache and retained persistent storage. |

Symbol palette, reference picker, review/track changes, editor tabs and the
browser-based Python runner are supplied by CE+ without an enable switch.
Docker sandboxed compiles and the separate Git bridge service are outside this
chart: they require additional services and privileges. GitHub sync is independent
of that Git bridge. This deployment remains suitable for trusted users.

## Example

```yaml
registration:
  enabled: true
  allowedEmailDomains: [example.org]
smtp:
  host: smtp.example.org
  port: 587
  sender: overleaf@example.org
  existingSecret: overleaf-smtp
compilation:
  timeoutSeconds: 600
  requestSizeMB: 50
uploads:
  maxSizeMB: 100
nginx:
  proxyTimeoutSeconds: 900
route:
  annotations:
    haproxy.router.openshift.io/timeout: 15m
templateGallery:
  enabled: true
  labels:
    thesis:
      name: Theses
      description: Department thesis templates
features:
  historyRestore: true
  pandocConversions: true
```

For OIDC, for example:

```yaml
authentication:
  methods: [oidc]
  existingSecret: overleaf-oidc # OVERLEAF_OIDC_CLIENT_SECRET
  settings:
    OVERLEAF_OIDC_ISSUER: https://id.example.org
    OVERLEAF_OIDC_AUTHORIZATION_URL: https://id.example.org/authorize
    OVERLEAF_OIDC_TOKEN_URL: https://id.example.org/token
    OVERLEAF_OIDC_USER_INFO_URL: https://id.example.org/userinfo
    OVERLEAF_OIDC_LOGOUT_URL: https://id.example.org/logout
    OVERLEAF_OIDC_CLIENT_ID: overleaf
    OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS: example.org
```

Use your provider's discovery document for endpoints. Decide whether to keep
local self-signup enabled when using external authentication.

## Migrating existing projects

Back up the databases, application data and existing Secret before changing
images. Keep the same PVCs and Secret. Helm rollback does not undo migrations.
To allow history restore for existing projects after enabling the feature:

```sh
oc exec statefulset/overleaf-mongo -- mongosh --quiet mongodb://127.0.0.1/sharelatex \
  --eval 'db.projects.updateMany({}, {$set: {"overleaf.history.rangesSupportEnabled": true}})'
```

## Sources and image compatibility

Configuration follows the [CE+ wiki](https://github.com/yu-i-i/overleaf-cep/wiki)
and [upstream environment variables](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/environment-variables).
The application base is pinned to `overleafcep/sharelatex:6.3.0-ext-v5.1` by digest.
The image carries over the validated TeX Live 2026 packages from our earlier
OpenShift images, adapts startup/nginx for arbitrary UIDs, and supplies the required
`analyticsId` omitted by CE+ v5.1's public registration helper.
