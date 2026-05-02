{{/*
Licensed under FSL-1.1-ALv2

Common helpers for the aldo-ai chart.
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "aldo-ai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec).
*/}}
{{- define "aldo-ai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "aldo-ai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "aldo-ai.labels" -}}
helm.sh/chart: {{ include "aldo-ai.chart" . }}
{{ include "aldo-ai.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: aldo-ai
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "aldo-ai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aldo-ai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Per-component selector labels. Component must be passed as `.component`.
*/}}
{{- define "aldo-ai.componentSelectorLabels" -}}
{{- include "aldo-ai.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Per-component labels.
*/}}
{{- define "aldo-ai.componentLabels" -}}
{{- include "aldo-ai.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "aldo-ai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "aldo-ai.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Postgres password Secret name. Used by both bundled and BYO modes — when
external is set, the chart references the operator-provided secret instead.
*/}}
{{- define "aldo-ai.postgresPasswordSecretName" -}}
{{- if .Values.postgres.enabled }}
{{- default (printf "%s-postgres" (include "aldo-ai.fullname" .)) .Values.postgres.passwordSecret.name }}
{{- else }}
{{- required "postgres.external.existingSecret is required when postgres.enabled is false" .Values.postgres.external.existingSecret }}
{{- end }}
{{- end }}

{{/*
Postgres password Secret key.
*/}}
{{- define "aldo-ai.postgresPasswordSecretKey" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.passwordSecret.key }}
{{- else }}
{{- .Values.postgres.external.existingSecretPasswordKey }}
{{- end }}
{{- end }}

{{/*
Postgres host.
*/}}
{{- define "aldo-ai.postgresHost" -}}
{{- if .Values.postgres.enabled }}
{{- printf "%s-postgres" (include "aldo-ai.fullname" .) }}
{{- else }}
{{- required "postgres.external.host is required when postgres.enabled is false" .Values.postgres.external.host }}
{{- end }}
{{- end }}

{{/*
Postgres port.
*/}}
{{- define "aldo-ai.postgresPort" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.service.port }}
{{- else }}
{{- .Values.postgres.external.port }}
{{- end }}
{{- end }}

{{/*
Postgres database name.
*/}}
{{- define "aldo-ai.postgresDatabase" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.database }}
{{- else }}
{{- .Values.postgres.external.database }}
{{- end }}
{{- end }}

{{/*
Postgres user.
*/}}
{{- define "aldo-ai.postgresUser" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.user }}
{{- else }}
{{- .Values.postgres.external.user }}
{{- end }}
{{- end }}

{{/*
App secrets Secret name. When BYO, this is the user-provided name; when
not, the chart mints a placeholder Secret.
*/}}
{{- define "aldo-ai.appSecretName" -}}
{{- if .Values.secrets.bringYourOwnSecret }}
{{- required "secrets.name is required when secrets.bringYourOwnSecret is true" .Values.secrets.name }}
{{- else }}
{{- printf "%s-app" (include "aldo-ai.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Image reference helpers — fall back to .Chart.AppVersion when tag is empty.
*/}}
{{- define "aldo-ai.apiImage" -}}
{{- $tag := default .Chart.AppVersion .Values.image.api.tag -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.api.repository $tag -}}
{{- end }}

{{- define "aldo-ai.webImage" -}}
{{- $tag := default .Chart.AppVersion .Values.image.web.tag -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.web.repository $tag -}}
{{- end }}
