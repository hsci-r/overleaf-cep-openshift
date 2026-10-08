{{- define "overleaf.settings" -}}
{{- if le (int .Values.nginx.proxyTimeoutSeconds) (int .Values.compilation.timeoutSeconds) -}}
{{- fail "nginx.proxyTimeoutSeconds must exceed compilation.timeoutSeconds" -}}
{{- end -}}
{{- if and .Values.integrations.githubSync.enabled (not .Values.integrations.githubSync.clientId) -}}
{{- fail "Set integrations.githubSync.clientId and supply GITHUB_SYNC_CLIENT_SECRET through a Secret" -}}
{{- end -}}
{{- if and .Values.integrations.zotero.enabled (not .Values.integrations.zotero.clientKey) -}}
{{- fail "Set integrations.zotero.clientKey and supply ZOTERO_CLIENT_SECRET through a Secret" -}}
{{- end -}}
{{- $linked := list "project_file" "project_output_file" -}}
{{- if .Values.features.linkedFilesFromUrl -}}{{- $linked = append $linked "url" -}}{{- end -}}
{{- if .Values.integrations.zotero.enabled -}}{{- $linked = append $linked "zotero" -}}{{- end -}}
{{- $settings := dict
  "OVERLEAF_ENABLE_REGISTRATION_PAGE" (.Values.registration.enabled | toString)
  "OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS" (join "," .Values.registration.allowedEmailDomains)
  "COMPILE_TIMEOUT" (.Values.compilation.timeoutSeconds | toString)
  "COMPILE_SIZE_LIMIT" (printf "%dmb" (int .Values.compilation.requestSizeMB))
  "COMPILE_BODY_SIZE_LIMIT_MB" (.Values.compilation.requestSizeMB | toString)
  "DEFAULT_LATEX_COMPILER" .Values.compilation.defaultCompiler
  "MAX_UPLOAD_SIZE" (.Values.uploads.maxSizeMB | toString)
  "PROJECT_UPLOAD_TIMEOUT" (mul .Values.uploads.timeoutSeconds 1000 | toString)
  "NGINX_PROXY_TIMEOUT_SECONDS" (.Values.nginx.proxyTimeoutSeconds | toString)
  "NGINX_KEEPALIVE_TIMEOUT" (.Values.nginx.keepaliveTimeoutSeconds | toString)
  "NGINX_WORKER_CONNECTIONS" (.Values.nginx.workerConnections | toString)
  "NGINX_WORKER_PROCESSES" (.Values.nginx.workerProcesses | toString)
  "OVERLEAF_HISTORY_RESTORE" (.Values.features.historyRestore | toString)
  "ENABLE_PANDOC_CONVERSIONS" (.Values.features.pandocConversions | toString)
  "OVERLEAF_DISABLE_CHAT" (not .Values.features.chat | toString)
  "ENABLED_LINKED_FILE_TYPES" (join "," $linked)
  "OVERLEAF_ALLOW_PUBLIC_ACCESS" (.Values.sharing.publicAccess | toString)
  "OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING" (.Values.sharing.anonymousReadWrite | toString)
  "OVERLEAF_DISABLE_LINK_SHARING" (not .Values.sharing.linkSharing | toString)
  "OVERLEAF_RESTRICT_INVITES_TO_EXISTING_ACCOUNTS" (.Values.sharing.restrictInvitesToExistingAccounts | toString)
  "OVERLEAF_TEMPLATE_GALLERY" (.Values.templateGallery.enabled | toString)
  "OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES" (.Values.templateGallery.nonAdminCanPublish | toString)
  "OVERLEAF_TEMPLATES_USER_ID" .Values.templateGallery.managerUserId
  "OVERLEAF_TEMPLATE_CATEGORIES" (join " " .Values.templateGallery.categories)
  "ENABLE_CRON_RESOURCE_DELETION" (.Values.retention.automaticDeletion | toString)
  "OVERLEAF_USER_HARD_DELETION_DELAY" (mul .Values.retention.deletedUsersDays 86400000 | toString)
  "OVERLEAF_PROJECT_HARD_DELETION_DELAY" (mul .Values.retention.deletedProjectsDays 86400000 | toString)
  "EXTERNAL_AUTH" (join " " .Values.authentication.methods)
  "GITHUB_SYNC_ENABLED" (.Values.integrations.githubSync.enabled | toString)
-}}
{{- if .Values.integrations.githubSync.enabled -}}
{{- $_ := set $settings "GITHUB_SYNC_CLIENT_ID" .Values.integrations.githubSync.clientId -}}
{{- end -}}
{{- if .Values.integrations.zotero.enabled -}}
{{- $_ := set $settings "ZOTERO_CLIENT_KEY" .Values.integrations.zotero.clientKey -}}
{{- end -}}
{{- range $category, $label := .Values.templateGallery.labels -}}
{{- $key := $category | upper | replace "-" "_" -}}
{{- with $label.name -}}{{- $_ := set $settings (printf "TEMPLATE_%s_NAME" $key) . -}}{{- end -}}
{{- with $label.description -}}{{- $_ := set $settings (printf "TEMPLATE_%s_DESCRIPTION" $key) . -}}{{- end -}}
{{- end -}}
{{- if .Values.smtp.host -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_HOST" .Values.smtp.host -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_PORT" (.Values.smtp.port | toString) -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_SECURE" (.Values.smtp.secure | toString) -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_TLS_REJECT_UNAUTH" (.Values.smtp.verifyCertificate | toString) -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_IGNORE_TLS" (.Values.smtp.ignoreStartTLS | toString) -}}
{{- $_ := set $settings "OVERLEAF_EMAIL_FROM_ADDRESS" (required "Set smtp.sender when smtp.host is configured" .Values.smtp.sender) -}}
{{- with .Values.smtp.replyTo -}}{{- $_ := set $settings "OVERLEAF_EMAIL_REPLY_TO" . -}}{{- end -}}
{{- with .Values.smtp.name -}}{{- $_ := set $settings "OVERLEAF_EMAIL_SMTP_NAME" . -}}{{- end -}}
{{- end -}}
{{- range $name, $value := .Values.authentication.settings -}}
{{- $_ := set $settings $name ($value | toString) -}}
{{- end -}}
{{- toYaml $settings -}}
{{- end -}}
