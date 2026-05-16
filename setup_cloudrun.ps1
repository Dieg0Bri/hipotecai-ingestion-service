# -----------------------------------------------------------------------------
# ingestion-service - build + deploy a Cloud Run
# -----------------------------------------------------------------------------
. "$PSScriptRoot\..\infra\config.ps1"

$SERVICE_BASE = "ingestion-service"
$SERVICE_NAME = Get-HipotecaiServiceName $SERVICE_BASE
$IMAGE        = "$AR_HOST/$PROJECT_ID/$AR_REPO/$($SERVICE_NAME):latest"
$SA_EMAIL     = "$SERVICE_BASE-sa@$PROJECT_ID.iam.gserviceaccount.com"

Write-Host "Ambiente    : $($Global:ENVIRONMENT.ToUpper())"
Write-Host "Servicio    : $SERVICE_NAME"
Write-Host "Imagen      : $IMAGE"
Write-Host "Service SA  : $SA_EMAIL"
Write-Host "Cloud SQL   : $INSTANCE_CONNECTION_NAME - base $DB_NAME"
Write-Host "Bucket docs : gs://$GCS_BUCKET_DOCUMENTOS"
Write-Host "Bucket OCR  : gs://$GCS_BUCKET_OCR  (firma .md derivado)"

Write-Host "`n[1/2] Construyendo imagen..." -ForegroundColor Yellow
gcloud builds submit . --tag $IMAGE --project $PROJECT_ID
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`n[2/2] Desplegando a Cloud Run..." -ForegroundColor Yellow

$nodeEnv = if ($Global:ENVIRONMENT -eq "prod") { "production" } else { "staging" }

gcloud run deploy $SERVICE_NAME `
  --image $IMAGE `
  --region $REGION `
  --project $PROJECT_ID `
  --platform managed `
  --service-account $SA_EMAIL `
  --allow-unauthenticated `
  --add-cloudsql-instances $INSTANCE_CONNECTION_NAME `
  --set-env-vars "NODE_ENV=$nodeEnv,DB_USER=$DB_USER,DB_NAME=$DB_NAME,DB_PORT=$DB_PORT,INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION_NAME,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,ALLOWED_ORIGINS=$ALLOWED_ORIGINS,GCS_BUCKET_DOCUMENTOS=$GCS_BUCKET_DOCUMENTOS,GCS_BUCKET_OCR=$GCS_BUCKET_OCR,GCS_SIGNED_URL_EXPIRATION_MINUTES=15,MAX_UPLOAD_SIZE_BYTES=52428800" `
  --set-secrets "DB_PASSWORD=$($SECRET_DB_PASSWORD):latest" `
  --port 8080 `
  --memory 1Gi `
  --cpu 1 `
  --timeout 300 `
  --concurrency 50 `
  --max-instances 10 `
  --min-instances 0

if ($LASTEXITCODE -eq 0) {
  $url = gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format="value(status.url)"
  Write-Host "`n[OK] Desplegado: $url" -ForegroundColor Green
}
