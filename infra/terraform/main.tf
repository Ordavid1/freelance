locals {
  apis     = toset(["cloudresourcemanager.googleapis.com", "run.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "aiplatform.googleapis.com"])
  accounts = toset(["runtime", "deployer", "builder"])
  project_roles = {
    runtime_vertex = { account = "runtime", role = "roles/aiplatform.user" }
    deployer_run   = { account = "deployer", role = "roles/run.developer" }
    deployer_build = { account = "deployer", role = "roles/cloudbuild.builds.editor" }
    deployer_usage = { account = "deployer", role = "roles/serviceusage.serviceUsageConsumer" }
    deployer_logs  = { account = "deployer", role = "roles/logging.viewer" }
    builder_logs   = { account = "builder", role = "roles/logging.logWriter" }
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
resource "google_storage_bucket_iam_member" "source" {
  for_each = toset(["builder", "deployer"])
  bucket   = google_storage_bucket.source.name
  role     = "roles/storage.objectUser"
  member   = "serviceAccount:${google_service_account.account[each.key].email}"
}
resource "google_cloud_run_v2_service" "engine" {
  count               = var.engine_image == null ? 0 : 1
  name                = "freelance-engine"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
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
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }
      startup_probe {
        tcp_socket { port = 8080 }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.api]
}
output "workload_identity_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "deployer_service_account" { value = google_service_account.account["deployer"].email }
output "engine_url" { value = try(google_cloud_run_v2_service.engine[0].uri, null) }
