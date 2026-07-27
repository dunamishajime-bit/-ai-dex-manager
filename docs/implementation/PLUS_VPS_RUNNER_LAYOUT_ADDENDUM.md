# VPS Runner Deployment Layout Addendum

This addendum is superseded by `docs/implementation/SPLIT_ATOMIC_VPS_MIGRATION.md`.

The read-only inspection proved that the production VPS does not have a single safe `VPS_APP_DIR`:

- source Git checkout: `/home/deploy/ai-dex-manager-v96-live`;
- trading execution: `/home/deploy/ai-dex-manager-v96-paper`, not Git-managed;
- UI execution: `/home/deploy/ai-dex-manager-ui`, with unproven `.next` build provenance.

Therefore `in-place-reviewed` is permanently rejected for this deployment. The supported mode is now only:

```text
VPS_DEPLOYMENT_LAYOUT_MODE=split-atomic-v2
```

Do not set that value until both PM2 and systemd have been explicitly migrated to the separate UI and trading `current` symlinks and exact-SHA release markers have been verified. Follow the migration document for variables, service templates, approval boundaries and proof requirements.
