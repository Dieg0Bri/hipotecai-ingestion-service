# ingestion-service

Servicio Node.js/Express que orquesta la **subida de documentos** al bucket de Cloud Storage de hipotecai y registra la ingesta en `dt_archivos`. También recibe los eventos de GCS vía Eventarc para iniciar la cadena de procesamiento.

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/api-ingestion/health` | público | Health |
| POST   | `/api-ingestion/upload/signed-upload-url` | OAuth | Devuelve URL V4 PUT firmada para que el frontend suba el archivo directo a GCS |
| GET    | `/api-ingestion/upload/signed-download-url` | OAuth | URL V4 GET firmada para el PDF original (tenant-scoped) |
| GET    | `/api-ingestion/upload/ocr-download-url`  | OAuth | URL V4 GET firmada para el `.md` OCR derivado, en bucket separado (tenant-scoped vía `dt_archivos`) |
| POST   | `/api-ingestion/upload/confirm`           | OAuth | Tras la subida directa, registra el archivo en `dt_archivos` |
| POST   | `/api-ingestion/upload`                   | OAuth | Subida multipart fallback (si la firma directa falla) |
| POST   | `/api-ingestion/eventarc`                 | OIDC  | Recibe CloudEvents de GCS (object finalize) |

**Por qué la firma del `.md` OCR vive acá** y no en `ocr-api`: firmar es CPU
puro, así que mantener despierta la instancia GPU L4 cada vez que el visor
abre un documento multiplicaba el costo. Y por qué no en `documentos-api`:
el tenant scoping ya vive acá para el PDF — meter signed URLs en otro
servicio duplicaba esa lógica.

## Flujo de ingesta recomendado (subida directa)

```
frontend                      ingestion-service              GCS                    Eventarc → clasificador-api
   │                                  │                       │                              │
   │ POST /signed-upload-url ─────────▶                       │                              │
   │                                  │── getSignedUrl ──────▶│                              │
   │ ◀── { upload_url, gcs_path } ────│                       │                              │
   │                                                                                         │
   │── PUT (file) ─────────────────────────────────────────▶  │                              │
   │                                                          │── object finalize ───────▶  │
   │ POST /upload/confirm ───────────▶                       │                              │
   │                                  │── INSERT dt_archivos ▶                              │
   │ ◀── { archivo, duplicate? } ─────│                                                       │
```

## Convención de paths en GCS

```
gs://hipotecai-documentos/{folio}/{timestamp}_{nombre_archivo}
```

Ej: `gs://hipotecai-documentos/EH-2026-0114/1714512000000_certificado_dominio.pdf`

## Detección de duplicados

Cada archivo se hashea con SHA-256 antes de registrar. Si ya existe un archivo con el mismo hash en el mismo estudio (`dt_archivos.sha256`), se devuelve `duplicate: true` y no se vuelve a registrar.

## Desarrollo

```bash
npm install
cp .env.example .env  # configurar GOOGLE_CLIENT_ID, GCS_BUCKET_DOCUMENTOS, DB_*
gcloud auth application-default login   # para usar GCS desde local
npm run dev
```

Puerto por defecto: `8083`.
