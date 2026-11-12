resource "google_service_account" "support_slack_scheduler" {
  account_id   = "freelance-support-slack"
  display_name = "Freelance support Slack sweep"
  depends_on   = [google_project_service.api]
}
# Sweeps due Slack outbox jobs (retries, parent cards, drafts). Each run is bounded and idempotent.
resource "google_cloud_scheduler_job" "support_slack" {
  count            = var.engine_image != null && var.support_slack_dispatch_enabled ? 1 : 0
  name             = "freelance-support-slack"
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "60s"
  http_target {
    uri         = "https://${var.canonical_domain}/api/support/slack/dispatch"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.support_slack_scheduler.email
      audience              = "https://${var.canonical_domain}/api/support/slack/dispatch"
    }
  }
  retry_config { retry_count = 0 }
  depends_on = [google_cloud_run_v2_service.engine]
  lifecycle {
    precondition {
      condition     = contains(keys(var.slack_secrets), "SLACK_BOT_TOKEN")
      error_message = "Slack dispatch requires a SLACK_BOT_TOKEN secret reference."
    }
  }
}
