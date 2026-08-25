# DisDex project operating rules

## Hosting and deployment

- Vercel is not used for this project. Do not run Vercel deployments, configure Vercel hosting, or treat a Vercel project as an active deployment target unless the user explicitly overrides this rule in the current task.
- The canonical hosting and runtime target is the XServer VPS at `professional-dismanager.net`.
- Use SSH with remote user `root` for VPS inspection and deployment.
- Use the private key at `C:\Users\dis\Desktop\DisDex.pem`.
- HP/UI changes must be reflected through the XServer VPS deployment path, not Vercel.

## Credential handling

- Never commit, print, or expose the private key or secret values from VPS environment files.
- If the Desktop key or XServer VPS target is unavailable, stop and report the blocker instead of switching to Vercel.

These rules apply to this project and should be followed in new Codex tasks opened for this repository.
