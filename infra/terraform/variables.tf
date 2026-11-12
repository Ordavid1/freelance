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
variable "edge_rate_limit_preview" {
  type        = bool
  default     = false
  description = "Observe the Cloud Armor per-IP API budget before enforcing it. Set false only after reviewing shared-IP traffic, OAuth and Cardcom callbacks."
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
variable "dribbble_client_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Public client ID from the Dribbble OAuth app."
}
variable "dribbble_client_secret_name" {
  type        = string
  default     = null
  nullable    = true
  description = "Existing Secret Manager secret containing the rotated Dribbble OAuth client secret."
}
variable "dribbble_client_secret_version" {
  type        = string
  default     = "1"
  description = "Enabled Secret Manager version for the Dribbble OAuth client secret."
}
variable "dribbble_redirect_uri" {
  type        = string
  default     = null
  nullable    = true
  description = "Registered Dribbble callback URI. Defaults to the canonical app host's callback route."
}

variable "billing_enabled" {
  type        = bool
  default     = false
  description = "Enable production Cardcom checkout and scheduled automatic renewals. Trial signup saves a card; its first monthly debit is due after the trial."
}
variable "cardcom_secrets" {
  type        = map(object({ project = string, name = string, version = string }))
  default     = {}
  description = "Existing Secret Manager references keyed by CARDCOM_TERMINAL_NUMBER, CARDCOM_API_NAME, optional CARDCOM_API_PASSWORD. Values never enter Terraform. Cross-project secrets are supported."
  validation {
    condition     = alltrue([for key in keys(var.cardcom_secrets) : contains(["CARDCOM_TERMINAL_NUMBER", "CARDCOM_API_NAME", "CARDCOM_API_PASSWORD"], key)])
    error_message = "Only the three supported Cardcom credential environment variables are allowed."
  }
  validation {
    condition     = alltrue([for ref in values(var.cardcom_secrets) : can(regex("^[1-9][0-9]*$", ref.version))])
    error_message = "Cardcom secret versions must be pinned positive version numbers, not latest aliases."
  }
}

variable "support_inbox_email" {
  type        = string
  default     = "customer@freelance-place.com"
  description = "Owner inbox receiving support notifications and allowed to reply into chat."
}
variable "support_from_email" {
  type        = string
  default     = ""
  description = "Sender on a domain verified in Resend. Empty keeps chat in email fallback mode."
}
variable "support_reply_domain" {
  type        = string
  default     = ""
  description = "Dedicated receiving subdomain configured with Resend MX; never replace the owner's inbox MX."
}
variable "support_allowed_reply_emails" {
  type        = list(string)
  default     = []
  description = "Additional owner/team email addresses allowed to reply into chat. The support inbox is always allowed."
}
variable "slack_secrets" {
  type        = map(object({ project = string, name = string, version = string }))
  default     = {}
  description = "Existing Secret Manager references for SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET. Values never enter Terraform."
  validation {
    condition     = alltrue([for key in keys(var.slack_secrets) : contains(["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"], key)])
    error_message = "Only SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are supported."
  }
  validation {
    condition     = alltrue([for ref in values(var.slack_secrets) : can(regex("^[1-9][0-9]*$", ref.version))])
    error_message = "Slack secret versions must be pinned positive version numbers."
  }
}
variable "support_slack_channel_id" {
  type        = string
  default     = ""
  description = "Slack channel ID of the #support console channel. Empty keeps Slack off."
}
variable "support_slack_agent_ids" {
  type        = list(string)
  default     = []
  description = "Slack user IDs allowed to reply to customers from the support channel."
}
variable "support_slack_dispatch_enabled" {
  type        = bool
  default     = false
  description = "Enable the every-minute Cloud Scheduler sweep of the Slack outbox."
}
variable "resend_secrets" {
  type        = map(object({ project = string, name = string, version = string }))
  default     = {}
  description = "Existing Secret Manager references for RESEND_API_KEY and RESEND_WEBHOOK_SECRET. Values never enter Terraform."
  validation {
    condition     = alltrue([for key in keys(var.resend_secrets) : contains(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"], key)])
    error_message = "Only RESEND_API_KEY and RESEND_WEBHOOK_SECRET are supported."
  }
  validation {
    condition     = alltrue([for ref in values(var.resend_secrets) : can(regex("^[1-9][0-9]*$", ref.version))])
    error_message = "Resend secret versions must be pinned positive version numbers."
  }
}
