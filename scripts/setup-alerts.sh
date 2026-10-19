#!/usr/bin/env bash
# Alerta por correo cuando las funciones de Bsale registran errores (cron,
# botón Sincronizar, webhooks, diagnóstico, escrituras). Máximo un correo por
# hora; se cierra sola a las 24 h sin errores. Idempotente en la práctica:
# si se corre dos veces crea un segundo canal/política (bórrelos en la consola).
#
#   bash scripts/setup-alerts.sh edmundo@spohr.cl
set -euo pipefail
EMAIL="${1:?Uso: setup-alerts.sh <correo>}"
PROJECT="comandas-charcuteria"

gcloud services enable monitoring.googleapis.com --project="$PROJECT"

CHANNEL=$(gcloud beta monitoring channels create \
  --project="$PROJECT" \
  --display-name="Comandas · alertas ($EMAIL)" \
  --type=email \
  --channel-labels=email_address="$EMAIL" \
  --format='value(name)')
echo "Canal: $CHANNEL"

POLICY=$(mktemp)
cat > "$POLICY" <<JSON
{
  "displayName": "Comandas · error en integración Bsale",
  "documentation": { "content": "Una función de Bsale registró un error. Revise Conexión Bsale en la app y los logs de Cloud Run (servicios bsale*).", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [{
    "displayName": "Errores en funciones bsale*",
    "conditionMatchedLog": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=~\"^bsale\" AND severity>=ERROR"
    }
  }],
  "alertStrategy": { "notificationRateLimit": { "period": "3600s" }, "autoClose": "86400s" },
  "notificationChannels": ["$CHANNEL"]
}
JSON
gcloud alpha monitoring policies create --project="$PROJECT" --policy-from-file="$POLICY"
rm -f "$POLICY"
echo "✓ Alerta creada: llegará un correo a $EMAIL ante errores de sincronización."
