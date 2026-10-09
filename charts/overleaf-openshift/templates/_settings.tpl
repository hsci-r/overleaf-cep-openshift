{{- define "overleaf.settings" -}}
{{- if and (eq .Values.compilation.backend "kubernetes") (le (int .Values.nginx.proxyTimeoutSeconds) (int .Values.compilation.kubernetes.requestTimeoutSeconds)) -}}
{{- fail "nginx.proxyTimeoutSeconds must exceed compilation.kubernetes.requestTimeoutSeconds" -}}
{{- end -}}
{{- if le (int .Values.nginx.proxyTimeoutSeconds) (int .Values.compilation.timeoutSeconds) -}}
{{- fail "nginx.proxyTimeoutSeconds must exceed compilation.timeoutSeconds" -}}
{{- end -}}
{{- $settings := dict
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
-}}
{{- toYaml $settings -}}
{{- end -}}
