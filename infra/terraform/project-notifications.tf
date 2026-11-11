variable "project_notifications_enabled" {
  type        = bool
  default     = false
  description = "Enable opted-in project alerts using the configured Resend sender/key."
}
variable "project_notifications_from_email" {
  type        = string
  default     = ""
  description = "Verified Resend sender. Empty reuses support_from_email."
}
resource "google_service_account" "notifications_scheduler" {
  account_id   = "freelance-project-mail"
  display_name = "Freelance project mail dispatcher"
  depends_on   = [google_project_service.api]
}
resource "google_cloud_scheduler_job" "project_notifications" {
  count            = var.engine_image != null && var.project_notifications_enabled ? 1 : 0
  name             = "freelance-project-notifications"
  region           = var.region
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"
  http_target {
    uri         = "https://${var.canonical_domain}/api/notifications/dispatch"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.notifications_scheduler.email
      audience              = "https://${var.canonical_domain}/api/notifications/dispatch"
    }
  }
  retry_config { retry_count = 1 }
  depends_on = [google_cloud_run_v2_service.engine]
  lifecycle {
    precondition {
      condition     = contains(keys(var.resend_secrets), "RESEND_API_KEY") && (var.project_notifications_from_email != "" || var.support_from_email != "")
      error_message = "Project notifications require a Resend key reference and verified sender."
    }
  }
}
