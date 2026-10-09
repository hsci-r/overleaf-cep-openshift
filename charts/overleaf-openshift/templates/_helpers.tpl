{{- define "overleaf.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- define "overleaf.fullname" -}}
{{- default (printf "%s-%s" .Release.Name (include "overleaf.name" .)) .Values.fullnameOverride | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- define "overleaf.labels" -}}
app.kubernetes.io/name: {{ include "overleaf.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}
{{- define "overleaf.selector" -}}
app.kubernetes.io/name: {{ include "overleaf.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "overleaf.securityContext" -}}
runAsNonRoot: true
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
seccompProfile:
  type: RuntimeDefault
{{- end -}}
{{- define "overleaf.mongoHost" -}}
{{ include "overleaf.fullname" . }}-mongo-0.{{ include "overleaf.fullname" . }}-mongo-headless.{{ .Release.Namespace }}.svc.cluster.local
{{- end -}}
{{- define "overleaf.siteUrl" -}}
{{- if .Values.siteUrl -}}
{{ .Values.siteUrl }}
{{- else if .Values.route.enabled -}}
https://{{ required "Set route.host to your unique hostname (e.g. overleaf.apps.example.org)" .Values.route.host }}
{{- else -}}
{{ required "Set siteUrl when route.enabled=false" .Values.siteUrl }}
{{- end -}}
{{- end -}}
{{- define "overleaf.claim" -}}
{{- $persistence := index .root.Values .component "persistence" -}}
{{- default (printf "%s-%s" (include "overleaf.fullname" .root) (.component | kebabcase)) $persistence.existingClaim -}}
{{- end -}}
