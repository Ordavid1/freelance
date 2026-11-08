variable "project_id" {
  type    = string
  default = "freelance-514118"
}
variable "region" {
  type    = string
  default = "me-west1"
}
variable "engine_image" {
  type        = string
  default     = null
  description = "Immutable image URI. Leave null until the application source is available."
}
