# Hajime Remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Personal remote desktop tools usable from Chat without Desktop Commander.
**Architecture:** Windows outbound polling app and independent VPS HTTPS MCP relay.
**Tech Stack:** Python standard library, SQLite, Win32, tkinter, nginx/systemd.
**Spec:** docs/superpowers/specs/2026-10-06-hajime-remote-design.md

## Global Constraints

- Python 3.12+; no paid API/service and no monthly action quota.
- Existing trading application and state must remain untouched.
- Only the owner can operate the PC; no unauthenticated operations.
- Writes require unique request_id and uncertain writes never replay.
- Windows runs as its ordinary interactive user, with DPAPI credential storage.

## Review Focus

- OAuth code/refresh replay and exact resource/redirect/PKCE binding.
- Agent reconnect after action execution but before result receipt.
- Locked desktop, DPI and negative virtual-screen origins.
- File path escape, output bounds and audit confidentiality.
- Pause or offline while jobs are queued; no late unexpected mutation.

### Task 1: Authenticated relay and MCP

**Files:** remote_app/store.py, auth.py, protocol.py, server.py; tests/test_relay.py.
**Interfaces:** Store.enqueue(tool, args, request_id), lease(device), finish(id,result);
Auth.register/authorize/exchange/validate; HTTP MCP initialize/list/call.

- [ ] Write integration tests for auth, PKCE/resource/replay and job idempotency/offline.
- [ ] Run unittest; observe missing implementation failure.
- [ ] Implement SQLite relay, OAuth and stateless MCP transport.
- [ ] Run full unittest suite and commit.

### Task 2: Windows app and execution

**Files:** remote_app/actions.py, windows.py, agent.py, desktop.py;
tests/test_actions.py and test_agent.py.
**Interfaces:** Actions.execute(tool,args), Agent.poll_once, durable local receipts.

- [ ] Write real filesystem/subprocess and delivery/replay/pause tests.
- [ ] Observe failures, implement bounded actions and durable receipt handling.
- [ ] Implement Win32 screenshot/input and Tk dashboard with pause/pairing controls.
- [ ] Run full suite and commit.

### Task 3: Installation, review and live smoke

**Files:** deploy/install_vps.py, install_windows.py, README.md.
**Interfaces:** installer accepts packaged source and creates only dedicated app resources.

- [ ] Test nginx route insertion/rollback and install idempotency on fixtures.
- [ ] Observe failures, implement installers and Chat setup instructions.
- [ ] Run full tests and independent whole-branch review; fix material findings.
- [ ] Push source, bootstrap VPS and Windows, verify real authenticated tools.
- [ ] Present concrete Chat connection URL and owner authentication step.
