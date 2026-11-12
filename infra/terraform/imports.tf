# Adopt resources created during initial bootstrap; retain these blocks for audit.
import {
  for_each = local.initial_apis
  to       = google_project_service.api[each.key]
  id       = "${var.project_id}/${each.key}"
}
import {
  to = google_project_service.api["storage.googleapis.com"]
  id = "${var.project_id}/storage.googleapis.com"
}
import {
  for_each = local.accounts
  to       = google_service_account.account[each.key]
  id       = "projects/${var.project_id}/serviceAccounts/freelance-${each.key}@${var.project_id}.iam.gserviceaccount.com"
}
import {
  to = google_artifact_registry_repository.images
  id = "projects/freelance-514118/locations/me-west1/repositories/freelance"
}
# Adopt the support Slack sweep resources that were created with gcloud before Terraform managed them.
import {
  to = google_service_account.support_slack_scheduler
  id = "projects/${var.project_id}/serviceAccounts/freelance-support-slack@${var.project_id}.iam.gserviceaccount.com"
}
import {
  for_each = var.engine_image != null && var.support_slack_dispatch_enabled ? toset(["support-slack"]) : toset([])
  to       = google_cloud_scheduler_job.support_slack[0]
  id       = "projects/${var.project_id}/locations/${var.region}/jobs/freelance-${each.key}"
}
