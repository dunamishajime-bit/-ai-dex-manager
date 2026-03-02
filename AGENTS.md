# Execution Policy (Project Local)

## Goal
- Keep implementation flow uninterrupted.
- Avoid per-command permission prompts during normal coding tasks.

## Default Behavior
- Proceed with edits, refactors, builds, tests, and deployment commands without asking each step.
- If a confirmation is unavoidable, bundle related actions and ask once.

## Required Marker For New Files
- Add this marker at the first line of every newly created source file:

```txt
// AUTO_CONTINUE: enabled
```

## Existing Files
- Do not mass-edit all files only to add the marker.
- Add the marker opportunistically when touching a file for functional changes.

## Notes
- This file defines repository workflow preference.
- Environment-level security/sandbox approval behavior is outside source-code control.
