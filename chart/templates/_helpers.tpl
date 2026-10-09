{{- define "wuflow.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-secrets" .Release.Name) }}
{{- end }}

{{- define "wuflow.secretKeyInitialAdminPassword" -}}
{{- .Values.secrets.existingSecretKeys.initialAdminPassword | default "initial-admin-password" }}
{{- end }}

{{- define "wuflow.secretKeySecretKey" -}}
{{- .Values.secrets.existingSecretKeys.secretKey | default "secret-key" }}
{{- end }}

{{- /* The cleartext values secrets.initialAdminPassword / secrets.secretKey were removed. Fail instead of silently ignoring them. */}}
{{- define "wuflow.validateSecrets" -}}
{{- if or .Values.secrets.initialAdminPassword .Values.secrets.secretKey }}
{{- fail "secrets.initialAdminPassword and secrets.secretKey were removed. Leave them unset to let the chart generate the secrets, or create your own Secret and set secrets.existingSecret — see the chart README, section Secrets." }}
{{- end }}
{{- end }}

{{- define "wuflow.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
