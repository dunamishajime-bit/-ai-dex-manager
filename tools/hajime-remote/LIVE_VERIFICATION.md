# Live verification — 2026-10-06

Runtime code commit: deba4eed6593809c9ffbf34873476254202d795c.
Status: Windows agent and VPS relay installed and running; owner Chat registration pending.

- Full unittest suite: 49 PASS.
- Native Windows: DPAPI round-trip; 3840×1080 GDI capture; actual click and Japanese Unicode input into a dedicated test window; managed child stops after parent exits; PowerShell Japanese output: PASS.
- Public HTTPS OAuth: dynamic registration, S256 PKCE, PC pairing, one-time code, token exchange: PASS.
- Public authenticated MCP through running Windows agent: status, PNG image content, atomic text write/read, PowerShell start/output: PASS. Dedicated smoke text file removed.
- Smoke OAuth token family revoked after test; no credentials or PIN included in source/evidence.
- Runtime service: dedicated hajime-remote user, loopback8798; nginx additive routes tested/reloaded with backup.
- Existing trading services/source/state were not modified by this task.

One independent fresh code review identified screenshot format, descendant process ownership, transient pause, refresh-family replay, and local retention defects. These were fixed and regression-tested. Runtime source hashes checked against local source on both Windows and VPS, normalizing Windows CRLF to LF. Final checks confirmed startup/desktop shortcuts, public OAuth metadata, denial of unauthenticated MCP requests, nginx configuration, and active/running service (18,391,040 bytes reported).

Minor review observations deferred: redirected/Unicode Windows desktop installer portability; unauthenticated DCR registration exhaustion; standardization of OAuth error identifiers. The current ASCII Windows paths and successful OAuth flow were verified directly. These are not a claim that all deployments/client error paths were validated.

No Chat tool invocation has yet occurred: manual creation/install and PC-code authorization in the owner's Chat account remain required. Follow README.md.

## Browser authorization correction

User-reported form submission at 12:32:40 JST received HTTP403. The page's no-referrer policy makes browsers serialize form POST Origin as null (Fetch Standard); the Origin guard rejects it. The old form-action self policy also omitted the registered Chat callback origin. HTML authorization responses now use strict-origin (no URL/query leakage), and CSP includes only self and the validated registered callback origin. Null/foreign Origin rejection remains intact.

Regression suite: 62 PASS. Public HTTPS flow reverified with browser-equivalent same-origin POST and corrected policy headers: OAuth approval/token exchange and authenticated PC screenshot/file/PowerShell smoke PASS. Deployed server source SHA256: 5d66978debeeb641cc3ec356074c990ca3f2d501089f1e68cf92156cbd261c1c; runtime release742cd86cd34270cf3179e1eb1f202b6a00ba2625. Owner should restart Chat's connection flow and generate a fresh PC code; actual owner Chat completion remains unverified.
