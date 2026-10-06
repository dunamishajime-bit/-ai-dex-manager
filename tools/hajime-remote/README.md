# Hajime Remote

Personal Windows desktop app and authenticated MCP relay on your existing XServer VPS.
Python standard library only; no separate paid API or Desktop Commander subscription.
Existing VPS and Chat subscription costs/limits still apply. PC must be awake and logged in.

## Chat connection

1. Open **Hajime Remote** on the Windows desktop. Status should show connected.
2. In Chat's Plugins settings, add a custom MCP server named **Hajime Remote**.
3. Server URL: `https://professional-dismanager.net/hajime-remote/mcp`.
4. Authentication: OAuth (automatic client registration; no manually entered client secret).
5. Press **Chat接続コードを発行** in the PC app. Enter its 8 digits on the authorization page within three minutes.
6. Install/enable the plugin, invoke it and ask to check PC status, then take a screenshot.

The availability of custom MCP plugins depends on Chat account/workspace settings.
Registration in the owner account must be completed before Chat can call these tools.

## Owner controls

**一時停止** rejects new operations; **再開** resumes them. **緊急停止** also stops
commands started by this app. **終了・切断** exits. Closing the window minimizes it.
A Windows login Startup shortcut launches the app; the desktop shortcut reopens it
when it is not already running. Locked/UAC secure desktops cannot be operated.

## Operations

Screen capture, visible windows, observed clicks, Unicode typing, shortcuts and scroll;
user-home text files with optimistic SHA checks; ordinary-user PowerShell/Python with
bounded output and timeouts. Reads omit known credential files. Shell execution has
normal user permissions and can access the same files as the user.

Every mutation requires a unique request_id; never submit a new ID to repeat an
uncertain operation. Poll get_operation_result instead. Relay and PC keep receipts;
inputs and results are scrubbed after 15 minutes, deduplication IDs retained 30 days.

The Windows agent authenticates using a DPAPI-protected local credential and initiates
outbound HTTPS. The VPS stores its hash; OAuth tokens are hashed and scoped to this PC.
A short-lived one-time PC code grants Chat access. Do not share that code.

## Service and validation

VPS: dedicated `hajime-remote.service`, loopback port8798, prefix `/hajime-remote/`,
independent state `/var/lib/hajime-remote`. nginx backup precedes additive route changes.
No trading application source, state or services are changed by this installer.

Run `python -m unittest discover -s tests`. Installation scripts are in `deploy/`.
Owner credentials are generated at installation and excluded from source control.
