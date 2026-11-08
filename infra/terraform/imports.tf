# Adopt resources created during initial bootstrap; retain these blocks for audit.
import {
  for_each = local.apis
  to       = google_project_service.api[each.key]
  id       = "${var.project_id}/${each.key}"
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
