resource "google_service_account" "maintenance_scheduler" {
  account_id   = "freelance-upload-maintenance"
  display_name = "Freelance private upload maintenance"
  depends_on   = [google_project_service.api]
}
resource "google_firestore_index" "stale_uploads" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "profileSources"
  query_scope = "COLLECTION_GROUP"
  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "ASCENDING"
  }
}
resource "google_cloud_scheduler_job" "upload_maintenance" {
  count            = var.engine_image == null ? 0 : 1
  name             = "freelance-stale-upload-cleanup"
  region           = var.region
  schedule         = "17 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"
  http_target {
    uri         = "https://${var.canonical_domain}/api/maintenance/uploads"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.maintenance_scheduler.email
      audience              = "https://${var.canonical_domain}/api/maintenance/uploads"
    }
  }
  retry_config { retry_count = 1 }
  depends_on = [google_cloud_run_v2_service.engine, google_firestore_index.stale_uploads]
}
