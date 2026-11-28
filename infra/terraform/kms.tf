# Cloud KMS key that seals Cardcom card tokens before they are stored in Firestore
# (src/lib/billing/token-vault.ts). Only the runtime service account can use it.
resource "google_kms_key_ring" "billing" {
  name       = "freelance-billing"
  location   = var.region
  depends_on = [google_project_service.api]
}
resource "google_kms_crypto_key" "cardcom_tokens" {
  name            = "cardcom-tokens"
  key_ring        = google_kms_key_ring.billing.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"
  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}
# Encrypt and decrypt for the runtime only; no other identity (including agent and deploy accounts) is granted use.
resource "google_kms_crypto_key_iam_member" "runtime_cardcom_tokens" {
  crypto_key_id = google_kms_crypto_key.cardcom_tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.account["runtime"].email}"
}
