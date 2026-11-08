# Freelance

Freelance Place production deployment foundation.

- [Deployment guide](deploy/README.md)
- [Verified deployment status and blockers](deploy/STATUS.md)
- [Terraform infrastructure](infra/terraform/main.tf)
- [GitHub Actions deployment](.github/workflows/deploy.yml)

The application source must be transferred from the existing laptop project. Deployment is skipped until `package.json` and `package-lock.json` are present.
