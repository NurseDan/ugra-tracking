#!/usr/bin/env bash
set -e

# Configuration
PROJECT_ID=${1:-"your-gcp-project-id"}
REGION=${2:-"us-central1"}
SERVICE_NAME="guadalupe-sentinel"
DB_INSTANCE="guadalupe-db"
DB_NAME="guadalupe"
DB_USER="postgres"
BQ_DATASET="river_data"

echo "Deploying to Project: $PROJECT_ID in Region: $REGION"

# 1. Enable Required APIs
echo "Enabling necessary Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  bigquery.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project $PROJECT_ID

echo "Setting up Artifact Registry for Cloud Build..."
if ! gcloud artifacts repositories describe app-repo --location=$REGION --project $PROJECT_ID > /dev/null 2>&1; then
  gcloud artifacts repositories create app-repo \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Guadalupe Sentinel" \
    --project $PROJECT_ID
fi

# 2. Setup BigQuery Dataset
echo "Setting up BigQuery dataset for Machine Learning..."
bq mk -f --location=US -d "$PROJECT_ID:$BQ_DATASET" || true

# 3. Setup Cloud SQL (PostgreSQL)
echo "Checking if Cloud SQL instance exists..."
if ! gcloud sql instances describe $DB_INSTANCE --project $PROJECT_ID > /dev/null 2>&1; then
  echo "Creating Cloud SQL PostgreSQL instance (this takes several minutes)..."
  gcloud sql instances create $DB_INSTANCE \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=$REGION \
    --project $PROJECT_ID
fi

# Create Database inside instance
gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE --project $PROJECT_ID || true

# Update password (auto-generating secure password)
DB_PASS=$(openssl rand -base64 15 | tr -dc 'a-zA-Z0-9')
echo "Generated secure password for database user..."
gcloud sql users set-password $DB_USER --instance=$DB_INSTANCE --password="$DB_PASS" --project $PROJECT_ID

# 4. Create Secrets in Secret Manager
echo "Storing secrets in Secret Manager..."
CONNECTION_NAME=$(gcloud sql instances describe $DB_INSTANCE --project $PROJECT_ID --format="value(connectionName)")
DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?host=/cloudsql/$CONNECTION_NAME"

echo -n "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=- --project $PROJECT_ID || \
echo -n "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=- --project $PROJECT_ID

echo "Granting Secret Manager access to Cloud Run service account..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None > /dev/null

# 5. Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --add-cloudsql-instances $CONNECTION_NAME \
  --set-env-vars="BQ_DATASET=$BQ_DATASET" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest"

# 6. Setup Cloud Scheduler
echo "Setting up Background Poller Scheduler (Scheduler runs in us-central1 regardless of app region)..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format="value(status.url)")

if ! gcloud scheduler jobs describe poller-tick --location us-central1 --project $PROJECT_ID > /dev/null 2>&1; then
  gcloud scheduler jobs create http poller-tick \
    --schedule="* * * * *" \
    --uri="$SERVICE_URL/api/internal/cron" \
    --http-method=POST \
    --location=us-central1 \
    --project $PROJECT_ID \
    --oidc-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
else
  gcloud scheduler jobs update http poller-tick \
    --uri="$SERVICE_URL/api/internal/cron" \
    --location=us-central1 \
    --project $PROJECT_ID
fi

echo ""
echo "✅ Deployment Complete! Service is running at: $SERVICE_URL"
echo ""
echo "=== NEXT STEPS FOR CI/CD & STRIPE ==="
echo "1. Connect your GitHub repository to Cloud Build in the Google Cloud Console."
echo "   It will use the cloudbuild.yaml file automatically."
echo "2. Add your Stripe API Keys to Secret Manager:"
echo "   gcloud secrets create STRIPE_SECRET_KEY --data-file=/path/to/key --project $PROJECT_ID"
echo "   gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=/path/to/webhook --project $PROJECT_ID"
echo "3. Update the Cloud Run service to mount these secrets:"
echo "   gcloud run services update $SERVICE_NAME --update-secrets=STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest --region $REGION --project $PROJECT_ID"
echo "====================================="
