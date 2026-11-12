variable "xplace_import_enabled" {
  type        = bool
  default     = true
  description = "Show the XPlace import UI and accept data captured by the Freelance Place browser extension or pasted by the user. Emergency switch: false hides it and refuses the import APIs."
}
variable "xplace_link_import_enabled" {
  type        = bool
  default     = true
  description = "Also let the server read a pasted public XPlace link (an automated fetch of one page per user action). Requires xplace_import_enabled. See docs/xplace-import.md."
}
variable "xplace_extension_url" {
  type        = string
  default     = "https://chromewebstore.google.com/detail/freelance-place-%E2%80%94-xplace/pmdpcogbhahimnbipapekgimgpkfnomn"
  description = "Chrome Web Store URL of the extension, shown to users who do not have it yet. Empty hides the install prompt."
}
