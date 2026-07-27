#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ops_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

ops_log() {
  printf '[%s] %s\n' "$(ops_now)" "$*" >&2
}

ops_die() {
  ops_log "ERROR: $*"
  exit 1
}

ops_require_command() {
  command -v "$1" >/dev/null 2>&1 || ops_die "required command is missing: $1"
}

ops_require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || ops_die "required environment variable is empty: ${name}"
}

ops_require_absolute_path() {
  local name="$1"
  local value="${!name:-}"
  ops_require_env "$name"
  [[ "$value" == /* ]] || ops_die "${name} must be an absolute path"
  [[ "$value" != "/" ]] || ops_die "${name} must not be /"
}

ops_validate_sha() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || ops_die "invalid exact commit SHA: ${value}"
}

ops_validate_service_name() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9_.@:-]+$ ]] || ops_die "invalid service/process name: ${value}"
}

ops_prepare_state_dir() {
  ops_require_absolute_path VPS_OPS_STATE_DIR
  mkdir -p "$VPS_OPS_STATE_DIR"
  chmod 700 "$VPS_OPS_STATE_DIR" 2>/dev/null || true
}

ops_acquire_global_lock() {
  ops_prepare_state_dir
  ops_require_command flock
  exec 9>"${VPS_OPS_STATE_DIR}/deployment.lock"
  flock -n 9 || ops_die "another VPS operation is already running"
}

ops_assert_repository() {
  ops_require_absolute_path VPS_APP_DIR
  [[ -d "$VPS_APP_DIR/.git" ]] || ops_die "VPS_APP_DIR is not a git working tree: ${VPS_APP_DIR}"
  git -C "$VPS_APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || ops_die "invalid git working tree"

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    local remote
    remote="$(git -C "$VPS_APP_DIR" remote get-url origin 2>/dev/null || true)"
    [[ "$remote" == *"${GITHUB_REPOSITORY}"* ]] || ops_die "origin does not match GITHUB_REPOSITORY"
  fi
}

ops_assert_clean_tracked_tree() {
  local dirty
  dirty="$(git -C "$VPS_APP_DIR" status --porcelain --untracked-files=no)"
  [[ -z "$dirty" ]] || ops_die "tracked files are modified on the VPS; refusing deployment"
}

ops_current_sha() {
  git -C "$VPS_APP_DIR" rev-parse HEAD
}

ops_fetch_exact_sha() {
  local target_sha="$1"
  ops_validate_sha "$target_sha"
  git -C "$VPS_APP_DIR" fetch --quiet --no-tags origin "$target_sha"
  local fetched
  fetched="$(git -C "$VPS_APP_DIR" rev-parse FETCH_HEAD)"
  [[ "$fetched" == "$target_sha" ]] || ops_die "fetched SHA does not match requested SHA"
}

ops_checkout_exact_sha() {
  local target_sha="$1"
  ops_fetch_exact_sha "$target_sha"
  git -C "$VPS_APP_DIR" checkout --detach --force "$target_sha"
  [[ "$(ops_current_sha)" == "$target_sha" ]] || ops_die "checkout did not reach requested SHA"
}

ops_service_state() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  case "$manager" in
    systemd)
      systemctl is-active "$name" 2>/dev/null || true
      ;;
    pm2)
      pm2 jlist 2>/dev/null | node -e '
        let input = "";
        process.stdin.on("data", chunk => input += chunk);
        process.stdin.on("end", () => {
          try {
            const name = process.argv[1];
            const rows = JSON.parse(input || "[]");
            const row = rows.find(item => item && item.name === name);
            process.stdout.write(row?.pm2_env?.status || "not-found");
          } catch {
            process.stdout.write("unknown");
          }
        });
      ' "$name"
      ;;
    *)
      ops_die "unsupported service manager: ${manager}"
      ;;
  esac
}

ops_service_pid() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  case "$manager" in
    systemd)
      systemctl show "$name" --property MainPID --value 2>/dev/null || printf '0\n'
      ;;
    pm2)
      pm2 jlist 2>/dev/null | node -e '
        let input = "";
        process.stdin.on("data", chunk => input += chunk);
        process.stdin.on("end", () => {
          try {
            const name = process.argv[1];
            const rows = JSON.parse(input || "[]");
            const row = rows.find(item => item && item.name === name);
            process.stdout.write(String(row?.pid || 0));
          } catch {
            process.stdout.write("0");
          }
        });
      ' "$name"
      ;;
    *)
      ops_die "unsupported service manager: ${manager}"
      ;;
  esac
}

ops_reload_ui() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  case "$manager" in
    systemd)
      sudo -n systemctl reload-or-restart "$name"
      ;;
    pm2)
      pm2 reload "$name" --update-env
      ;;
    *)
      ops_die "unsupported UI service manager: ${manager}"
      ;;
  esac
}

ops_restart_trading() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  case "$manager" in
    systemd)
      sudo -n systemctl restart "$name"
      ;;
    pm2)
      pm2 restart "$name" --update-env
      ;;
    *)
      ops_die "unsupported trading service manager: ${manager}"
      ;;
  esac
}

ops_http_code() {
  local url="$1"
  [[ "$url" =~ ^https?:// ]] || ops_die "health URL must start with http:// or https://"
  curl --silent --show-error --location --max-time "${VPS_HTTP_TIMEOUT_SECONDS:-15}" --output /dev/null --write-out '%{http_code}' "$url"
}

ops_require_http_success() {
  local label="$1"
  local url="$2"
  local code
  code="$(ops_http_code "$url")"
  [[ "$code" =~ ^2[0-9][0-9]$ ]] || ops_die "${label} health check failed with HTTP ${code}"
  ops_log "${label} health check passed with HTTP ${code}"
}

ops_run_in_app() {
  local label="$1"
  shift
  ops_log "starting: ${label}"
  (
    cd "$VPS_APP_DIR"
    timeout --preserve-status "${VPS_COMMAND_TIMEOUT:-30m}" "$@"
  )
  ops_log "passed: ${label}"
}

ops_write_sha_file() {
  local path="$1"
  local sha="$2"
  ops_validate_sha "$sha"
  local tmp="${path}.tmp.$$"
  printf '%s\n' "$sha" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$path"
}

ops_json_report() {
  local output_path="$1"
  shift
  node - "$output_path" "$@" <<'NODE'
const fs = require('node:fs');
const [outputPath, ...pairs] = process.argv.slice(2);
const data = {};
for (const pair of pairs) {
  const index = pair.indexOf('=');
  if (index < 1) continue;
  const key = pair.slice(0, index);
  const raw = pair.slice(index + 1);
  if (raw === 'true') data[key] = true;
  else if (raw === 'false') data[key] = false;
  else if (/^-?\d+(?:\.\d+)?$/.test(raw)) data[key] = Number(raw);
  else data[key] = raw;
}
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
NODE
}
