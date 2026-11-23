# Budget guard: a Cloud Billing budget publishes spend notifications to Pub/Sub, and a push subscription
# delivers them, with an OIDC token, to POST /api/maintenance/budget. When spend crosses BUDGET_AI_CUTOFF
# (default 100%) the app sets Firestore runtimeSwitches/ai {enabled:false} and generative AI stops within
# 30 seconds on every instance. Re-enabling is manual: docs/security-operations.md.
#
# The budget is created only when billing_account_id is set (it needs billing-account level permission that the
# deploy identity may not have). Without it the topic, subscription and endpoint still exist, and the same
# notifications can be wired from the console.
#
# Firestore TTL: the new documents need no new TTL field. Global and per-address budgets live in
# securityRateLimits (expiresAt, security_rate_limit_expiry in main.tf); runtimeSwitches and
# securityAuditEvents are small, deliberate records that are kept.

resource "google_service_account" "budget_push" {
  account_id   = "freelance-budget-push"
  display_name = "Freelance budget alert push delivery"
  depends_on   = [google_project_service.api]
}
resource "google_pubsub_topic" "budget_alerts" {
  name       = "freelance-budget-alerts"
  depends_on = [google_project_service.api]
}
# Pub/Sub signs the push request's OIDC token as the push service account; its own service agent needs to mint it.
resource "google_service_account_iam_member" "pubsub_mints_budget_push_token" {
  service_account_id = google_service_account.budget_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  depends_on         = [google_project_service.api]
}
resource "google_pubsub_subscription" "budget_alerts_push" {
  # Budget notifications repeat while spend stays over a threshold, so a day of retention is plenty.
  count                      = var.engine_image == null ? 0 : 1
  name                       = "freelance-budget-alerts-push"
  topic                      = google_pubsub_topic.budget_alerts.id
  ack_deadline_seconds       = 20
  message_retention_duration = "86400s"
  push_config {
    push_endpoint = "https://${var.canonical_domain}/api/maintenance/budget"
    oidc_token {
      service_account_email = google_service_account.budget_push.email
      audience              = "https://${var.canonical_domain}/api/maintenance/budget"
    }
  }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }
  depends_on = [google_cloud_run_v2_service.engine, google_service_account_iam_member.pubsub_mints_budget_push_token]
}
resource "google_billing_budget" "ai_cost" {
  count           = var.billing_account_id == null ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "Freelance Place monthly cost guard"
  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }
  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.budget_alerts.id
    schema_version = "1.0"
  }
  depends_on = [google_project_service.api]
}
