locals {
  initial_apis = toset(["cloudresourcemanager.googleapis.com", "run.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "aiplatform.googleapis.com"])
  apis         = toset(["cloudresourcemanager.googleapis.com", "run.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "aiplatform.googleapis.com", "identitytoolkit.googleapis.com", "firebase.googleapis.com", "firestore.googleapis.com", "firebaserules.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com", "compute.googleapis.com", "cloudscheduler.googleapis.com"])
  accounts     = toset(["runtime", "deployer", "builder"])
  project_roles = {
    runtime_vertex    = { account = "runtime", role = "roles/aiplatform.user" }
    runtime_firestore = { account = "runtime", role = "roles/datastore.user" }
    deployer_run      = { account = "deployer", role = "roles/run.developer" }
    deployer_build    = { account = "deployer", role = "roles/cloudbuild.builds.editor" }
    deployer_usage    = { account = "deployer", role = "roles/serviceusage.serviceUsageConsumer" }
    deployer_logs     = { account = "deployer", role = "roles/logging.viewer" }
    builder_logs      = { account = "builder", role = "roles/logging.logWriter" }
  }
}
data "google_project" "current" {}
resource "google_project_service" "api" {
  for_each           = local.apis
  service            = each.key
  disable_on_destroy = false
}
resource "google_service_account" "account" {
  for_each     = local.accounts
  account_id   = "freelance-${each.key}"
  display_name = "freelance-${each.key}"
  depends_on   = [google_project_service.api]
}
resource "google_project_iam_member" "role" {
  for_each = local.project_roles
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.account[each.value.account].email}"
}
resource "google_project_iam_custom_role" "runtime_auth_session" {
  project     = var.project_id
  role_id     = "freelanceRuntimeAuthSession"
  title       = "Freelance Runtime Auth Sessions"
  description = "Allows the runtime to create and verify sessions without managing user accounts."
  permissions = ["firebaseauth.users.createSession", "firebaseauth.users.get"]
  stage       = "GA"
}
resource "google_project_iam_member" "runtime_auth_session" {
  project = var.project_id
  role    = google_project_iam_custom_role.runtime_auth_session.name
  member  = "serviceAccount:${google_service_account.account["runtime"].email}"
}
resource "google_secret_manager_secret_iam_member" "runtime_nango" {
  count      = var.nango_secret_name == null ? 0 : 1
  project    = var.project_id
  secret_id  = var.nango_secret_name
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.account["runtime"].email}"
  depends_on = [google_project_service.api]
}
resource "google_secret_manager_secret_iam_member" "runtime_dribbble" {
  count      = var.dribbble_client_secret_name == null ? 0 : 1
  project    = var.project_id
  secret_id  = var.dribbble_client_secret_name
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.account["runtime"].email}"
  depends_on = [google_project_service.api]
}
resource "google_secret_manager_secret_iam_member" "runtime_cardcom" {
  for_each   = var.cardcom_secrets
  project    = each.value.project
  secret_id  = each.value.name
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.account["runtime"].email}"
  depends_on = [google_project_service.api]
}
resource "google_service_account" "billing_scheduler" {
  account_id   = "freelance-billing-scheduler"
  display_name = "Freelance Cardcom renewal scheduler"
  depends_on   = [google_project_service.api]
}
resource "google_cloud_scheduler_job" "billing" {
  count            = var.billing_enabled && var.engine_image != null ? 1 : 0
  name             = "freelance-membership-renewal"
  region           = var.region
  schedule         = "*/15 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"
  http_target {
    uri         = "https://${var.canonical_domain}/api/billing/renew"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.billing_scheduler.email
      audience              = "https://${var.canonical_domain}/api/billing/renew"
    }
  }
  retry_config {
    retry_count          = 2
    min_backoff_duration = "120s"
    max_backoff_duration = "300s"
  }
  depends_on = [google_project_service.api, google_cloud_run_v2_service.engine]
}
resource "google_firestore_index" "billing_due" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "billingSubscriptions"
  query_scope = "COLLECTION"
  fields {
    field_path = "autoRenew"
    order      = "ASCENDING"
  }
  fields {
    field_path = "nextChargeAt"
    order      = "ASCENDING"
  }
}
resource "google_firestore_index" "billing_history" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "billingOrders"
  query_scope = "COLLECTION"
  fields {
    field_path = "uid"
    order      = "ASCENDING"
  }
  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
  fields {
    field_path = "paidAt"
    order      = "DESCENDING"
  }
}
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "freelance"
  format        = "DOCKER"
  depends_on    = [google_project_service.api]
}
resource "google_artifact_registry_repository_iam_member" "images" {
  for_each   = { builder = "roles/artifactregistry.writer", deployer = "roles/artifactregistry.reader" }
  location   = var.region
  repository = google_artifact_registry_repository.images.name
  role       = each.value
  member     = "serviceAccount:${google_service_account.account[each.key].email}"
}
resource "google_service_account_iam_member" "act_as" {
  for_each           = toset(["runtime", "builder"])
  service_account_id = google_service_account.account[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.account["deployer"].email}"
}
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.api]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "freelance"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
  }
  attribute_condition = "assertion.repository_id == '1450584138' && assertion.repository_owner_id == '43148515' && assertion.ref == 'refs/heads/main' && assertion.event_name in ['push', 'workflow_dispatch']"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "github" {
  service_account_id = google_service_account.account["deployer"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/1450584138"
}
resource "google_storage_bucket" "source" {
  name                        = "${var.project_id}-build-source"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
}
resource "google_storage_bucket" "user_uploads" {
  name                        = "${var.project_id}-user-uploads"
  location                    = var.data_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  lifecycle_rule {
    condition {
      age        = 7
      with_state = "ARCHIVED"
    }
    action { type = "Delete" }
  }

  lifecycle {
    prevent_destroy = true
  }
}
resource "google_storage_bucket_iam_member" "user_uploads_runtime" {
  bucket = google_storage_bucket.user_uploads.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.account["runtime"].email}"
}
resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = var.data_location
  type                              = "FIRESTORE_NATIVE"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "PREVENT"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.api]
}
resource "google_firestore_backup_schedule" "daily" {
  project   = var.project_id
  database  = google_firestore_database.default.name
  retention = "2592000s"
  daily_recurrence {}
}
resource "google_firebaserules_ruleset" "server_only" {
  project = var.project_id
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/firestore.rules")
    }
  }
  depends_on = [google_project_service.api]
}
resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.server_only.name
  depends_on   = [google_firestore_database.default]
}
resource "google_firestore_field" "security_rate_limit_expiry" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "securityRateLimits"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}
resource "google_identity_platform_config" "default" {
  project = var.project_id
  sign_in {
    phone_number {
      enabled = false
    }
    email {
      enabled           = true
      password_required = true
    }
  }
  authorized_domains = distinct(concat(var.auth_authorized_domains, [var.canonical_domain, "www.${var.canonical_domain}"]))
  depends_on         = [google_project_service.api]
}
resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Freelance Place"
  depends_on   = [google_identity_platform_config.default]
}
data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}
resource "google_storage_bucket_iam_member" "source" {
  for_each = toset(["builder", "deployer"])
  bucket   = google_storage_bucket.source.name
  role     = "roles/storage.objectUser"
  member   = "serviceAccount:${google_service_account.account[each.key].email}"
}
resource "google_storage_bucket_iam_member" "source_deployer_metadata" {
  bucket = google_storage_bucket.source.name
  # gcloud builds submit checks bucket metadata before uploading source.
  # roles/storage.objectUser alone does not include storage.buckets.get.
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.account["deployer"].email}"
}
resource "google_cloud_run_v2_service" "engine" {
  count               = var.engine_image == null ? 0 : 1
  name                = "freelance-engine"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account = google_service_account.account["runtime"].email
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
    containers {
      image = var.engine_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "SITE_INDEXABLE"
        value = "true"
      }
      env {
        name  = "NEXT_PUBLIC_SITE_URL"
        value = "https://${var.canonical_domain}"
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }
      env {
        name  = "AI_GENERATION_ENABLED"
        value = tostring(var.ai_generation_enabled)
      }
      env {
        name  = "VERTEX_MODEL_ID"
        value = "gemini-3.8-flash"
      }
      env {
        name  = "GOOGLE_GENAI_USE_ENTERPRISE"
        value = "True"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "UPLOADS_BUCKET"
        value = google_storage_bucket.user_uploads.name
      }
      env {
        name  = "FIREBASE_WEB_API_KEY"
        value = data.google_firebase_web_app_config.web.api_key
      }
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = data.google_firebase_web_app_config.web.auth_domain
      }
      env {
        name  = "FIREBASE_WEB_APP_ID"
        value = google_firebase_web_app.web.app_id
      }
      env {
        name  = "GOOGLE_SIGN_IN_ENABLED"
        value = tostring(var.google_sign_in_enabled)
      }
      dynamic "env" {
        for_each = var.nango_secret_name == null ? [] : [var.nango_secret_name]
        content {
          name = "NANGO_API_KEY"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = var.nango_secret_version
            }
          }
        }
      }
      env {
        name  = "NANGO_GITHUB_INTEGRATION_ID"
        value = var.nango_github_integration_id
      }
      env {
        name  = "NANGO_LINKEDIN_INTEGRATION_ID"
        value = var.nango_linkedin_integration_id
      }
      env {
        name  = "DRIBBBLE_CLIENT_ID"
        value = var.dribbble_client_id == null ? "" : var.dribbble_client_id
      }
      env {
        name  = "DRIBBBLE_REDIRECT_URI"
        value = coalesce(var.dribbble_redirect_uri, "https://${var.canonical_domain}/api/integrations/dribbble/callback")
      }
      dynamic "env" {
        for_each = var.dribbble_client_secret_name == null ? [] : [var.dribbble_client_secret_name]
        content {
          name = "DRIBBBLE_CLIENT_SECRET"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = var.dribbble_client_secret_version
            }
          }
        }
      }
      env {
        name  = "BILLING_ENABLED"
        value = tostring(var.billing_enabled)
      }
      env {
        name  = "BILLING_SCHEDULER_EMAIL"
        value = google_service_account.billing_scheduler.email
      }
      dynamic "env" {
        for_each = var.cardcom_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = "projects/${env.value.project}/secrets/${env.value.name}"
              version = env.value.version
            }
          }
        }
      }
      startup_probe {
        tcp_socket { port = 8080 }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = !var.billing_enabled || alltrue([for key in ["CARDCOM_TERMINAL_NUMBER", "CARDCOM_API_NAME"] : contains(keys(var.cardcom_secrets), key)])
      error_message = "Enabled billing requires terminal number and API name secret references."
    }
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.api, google_secret_manager_secret_iam_member.runtime_nango, google_secret_manager_secret_iam_member.runtime_dribbble, google_secret_manager_secret_iam_member.runtime_cardcom]
}
resource "google_cloud_run_v2_service_iam_member" "public_web_invoker" {
  count    = var.engine_image == null ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.engine[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_compute_global_address" "website" {
  count        = var.engine_image == null ? 0 : 1
  name         = "freelance-website-ip"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}
resource "google_compute_region_network_endpoint_group" "website" {
  count                 = var.engine_image == null ? 0 : 1
  name                  = "freelance-engine-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run { service = google_cloud_run_v2_service.engine[0].name }
}
resource "google_compute_backend_service" "website" {
  count                 = var.engine_image == null ? 0 : 1
  name                  = "freelance-engine-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.website[0].id
  log_config {
    enable      = true
    sample_rate = 1.0
  }
  backend { group = google_compute_region_network_endpoint_group.website[0].id }
}
resource "google_compute_security_policy" "website" {
  count = var.engine_image == null ? 0 : 1
  name  = "freelance-marketplace-edge"
  # Preview first: shared office/mobile IPs and code-rich project briefs must
  # be measured before enforcement. App account quotas remain enforced.
  rule {
    priority = 1000
    action   = "throttle"
    preview  = var.edge_rate_limit_preview
    match {
      expr { expression = "request.path.startsWith('/api/')" }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
    }
    description = "Per-IP API budget; inspect preview logs before enforcement."
  }
  rule {
    priority = 2147483647
    action   = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    description = "Public marketplace and search traffic."
  }
}
resource "google_compute_url_map" "website" {
  count           = var.engine_image == null ? 0 : 1
  name            = "freelance-website-map"
  default_service = google_compute_backend_service.website[0].id
  host_rule {
    hosts        = [var.canonical_domain, "www.${var.canonical_domain}"]
    path_matcher = "all-paths"
  }
  path_matcher {
    name            = "all-paths"
    default_service = google_compute_backend_service.website[0].id
  }
}
resource "google_compute_managed_ssl_certificate" "website" {
  count = var.engine_image == null ? 0 : 1
  name  = "freelance-website-cert"
  managed { domains = [var.canonical_domain, "www.${var.canonical_domain}"] }
}
resource "google_compute_target_https_proxy" "website" {
  count            = var.engine_image == null ? 0 : 1
  name             = "freelance-website-https"
  url_map          = google_compute_url_map.website[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.website[0].id]
  ssl_policy       = google_compute_ssl_policy.website[0].id
}
resource "google_compute_ssl_policy" "website" {
  count           = var.engine_image == null ? 0 : 1
  name            = "freelance-website-tls"
  min_tls_version = "TLS_1_2"
  profile         = "MODERN"
}
resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.engine_image == null ? 0 : 1
  name                  = "freelance-website-https"
  target                = google_compute_target_https_proxy.website[0].id
  ip_address            = google_compute_global_address.website[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
resource "google_compute_url_map" "http_redirect" {
  count = var.engine_image == null ? 0 : 1
  name  = "freelance-http-redirect"
  default_url_redirect {
    https_redirect         = true
    host_redirect          = var.canonical_domain
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}
resource "google_compute_target_http_proxy" "http_redirect" {
  count   = var.engine_image == null ? 0 : 1
  name    = "freelance-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}
resource "google_compute_global_forwarding_rule" "http_redirect" {
  count                 = var.engine_image == null ? 0 : 1
  name                  = "freelance-website-http-redirect"
  target                = google_compute_target_http_proxy.http_redirect[0].id
  ip_address            = google_compute_global_address.website[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
output "workload_identity_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "deployer_service_account" { value = google_service_account.account["deployer"].email }
output "engine_url" { value = try(google_cloud_run_v2_service.engine[0].uri, null) }
output "user_uploads_bucket" { value = google_storage_bucket.user_uploads.name }
output "firestore_database" { value = google_firestore_database.default.name }
output "firebase_web_api_key" { value = data.google_firebase_web_app_config.web.api_key }
output "firebase_auth_domain" { value = data.google_firebase_web_app_config.web.auth_domain }
output "firebase_web_app_id" { value = google_firebase_web_app.web.app_id }
output "website_ip_address" { value = try(google_compute_global_address.website[0].address, null) }
output "website_dns_records" {
  value = try({
    apex_a      = google_compute_global_address.website[0].address
    www_cname   = var.canonical_domain
    certificate = "Google managed certificate for ${var.canonical_domain} and www.${var.canonical_domain}"
  }, null)
}
