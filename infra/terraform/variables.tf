variable "project_id" {
  type    = string
  default = "freelance-514118"
}
variable "region" {
  type    = string
  default = "me-west1"
}
variable "canonical_domain" {
  type        = string
  default     = "freelance-place.com"
  description = "Primary public hostname for the Freelance Place website."
}
variable "google_sign_in_enabled" {
  type        = bool
  default     = false
  description = "Enable the Google sign-in button only after Identity Platform's OAuth web client has been configured."
}
variable "data_location" {
  type        = string
  default     = "me-west1"
  description = "Regional location for Firestore and private user uploads. Firestore location is immutable after creation."
}
variable "auth_authorized_domains" {
  type        = list(string)
  default     = ["localhost", "freelance-514118.firebaseapp.com", "freelance-514118.web.app"]
  description = "Identity Platform domains allowed to complete sign-in. Add the verified production hostname before enabling Google sign-in there."
}
variable "engine_image" {
  type        = string
  default     = null
  description = "Immutable image URI. Leave null until the application source is available."
}
variable "nango_secret_name" {
  type        = string
  default     = "NANGO_API_KEY"
  description = "Existing Secret Manager secret with an active Nango API key version. Leave null until configured; the secret value is never stored in Terraform."
  nullable    = true
}
variable "nango_secret_version" {
  type        = string
  default     = "1"
  description = "Enabled Secret Manager version deployed to Cloud Run. Update explicitly when rotating the Nango key."
}
variable "nango_github_integration_id" {
  type        = string
  default     = "github"
  description = "Integration ID configured in the Nango environment for GitHub OAuth."
}
variable "nango_linkedin_integration_id" {
  type        = string
  default     = "linkedin"
  description = "Integration ID configured in the Nango environment for LinkedIn OAuth."
}

variable "billing_enabled" {
  type        = bool
  default     = false
  description = "Enable Cardcom checkout and scheduled automatic renewals after sandbox validation."
}
variable "cardcom_secrets" {
  type        = map(object({ project = string, name = string, version = string }))
  default     = {}
  description = "Existing Secret Manager references keyed by CARDCOM_TERMINAL_NUMBER, CARDCOM_API_NAME, optional CARDCOM_API_PASSWORD. Values never enter Terraform. Cross-project secrets are supported."
  validation {
    condition     = alltrue([for key in keys(var.cardcom_secrets) : contains(["CARDCOM_TERMINAL_NUMBER", "CARDCOM_API_NAME", "CARDCOM_API_PASSWORD"], key)])
    error_message = "Only the three supported Cardcom credential environment variables are allowed."
  }
}
