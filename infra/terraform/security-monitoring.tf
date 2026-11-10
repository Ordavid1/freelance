variable "security_notification_channels" {
  type        = list(string)
  default     = []
  description = "Existing verified Monitoring notification channel resource names. Configure before relying on paging."
}
variable "ai_generation_enabled" {
  type        = bool
  default     = true
  description = "Emergency switch for new AI generation; does not affect billing cancellation or reads."
}
resource "google_project_service" "monitoring" {
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}
resource "google_monitoring_alert_policy" "security_events" {
  display_name          = "Marketplace billing or quota infrastructure failure"
  combiner              = "OR"
  notification_channels = var.security_notification_channels
  conditions {
    display_name = "Failed renewal batch or unavailable abuse limiter"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"freelance-engine\" AND ((jsonPayload.event=\"billing_renewal_batch\" AND jsonPayload.failed>0) OR textPayload=\"security_rate_limit_unavailable\")"
    }
  }
  alert_strategy {
    notification_rate_limit { period = "300s" }
    auto_close = "1800s"
  }
  documentation {
    content   = "Use docs/security-operations.md. Inspect only sanitized order outcomes; never retry a charge with a new gateway ID. Configure verified notification channels before relying on this policy."
    mime_type = "text/markdown"
  }
  depends_on = [google_project_service.monitoring]
}
resource "google_monitoring_alert_policy" "server_errors" {
  display_name          = "Marketplace sustained server errors"
  combiner              = "OR"
  notification_channels = var.security_notification_channels
  conditions {
    display_name = "More than five server errors per minute for five minutes"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"freelance-engine\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.0833333333
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.monitoring]
}
