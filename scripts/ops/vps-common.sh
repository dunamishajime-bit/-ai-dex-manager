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

ops_validate_preflight_template() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9_.:-]+@\.service$ ]] || ops_die "invalid preflight service template: ${value}"
}

ops_require_atomic_layout() {
  ops_require_env VPS_DEPLOYMENT_LAYOUT_MODE
  [[ "$VPS_DEPLOYMENT_LAYOUT_MODE" == "split-atomic-v2" ]] || \
    ops_die "VPS_DEPLOYMENT_LAYOUT_MODE must be split-atomic-v2 after the UI and trading services have been migrated to their current symlinks"
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

ops_source_repo_dir() {
  printf '%s\n' "${VPS_SOURCE_REPO_DIR:-${VPS_APP_DIR:-}}"
}

ops_assert_source_repository() {
  local source_dir
  source_dir="$(ops_source_repo_dir)"
  [[ -n "$source_dir" ]] || ops_die "VPS_SOURCE_REPO_DIR is required"
  [[ "$source_dir" == /* && "$source_dir" != "/" ]] || ops_die "VPS_SOURCE_REPO_DIR must be a non-root absolute path"
  [[ -d "$source_dir/.git" ]] || ops_die "VPS_SOURCE_REPO_DIR is not a git working tree: ${source_dir}"
  git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || ops_die "invalid source git working tree"

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    local remote
    remote="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
    [[ "$remote" == *"${GITHUB_REPOSITORY}"* ]] || ops_die "source origin does not match GITHUB_REPOSITORY"
  fi
}

ops_assert_clean_source_tree() {
  local source_dir dirty
  source_dir="$(ops_source_repo_dir)"
  dirty="$(git -C "$source_dir" status --porcelain --untracked-files=no)"
  [[ -z "$dirty" ]] || ops_die "tracked files are modified in VPS_SOURCE_REPO_DIR; refusing deployment"
}

ops_source_sha() {
  git -C "$(ops_source_repo_dir)" rev-parse HEAD
}

ops_fetch_exact_sha() {
  local target_sha="$1"
  local source_dir
  ops_validate_sha "$target_sha"
  ops_assert_source_repository
  source_dir="$(ops_source_repo_dir)"
  git -C "$source_dir" fetch --quiet --no-tags origin "$target_sha"
  local fetched
  fetched="$(git -C "$source_dir" rev-parse FETCH_HEAD)"
  [[ "$fetched" == "$target_sha" ]] || ops_die "fetched SHA does not match requested SHA"
}

ops_release_sha() {
  local release_dir="$1"
  local marker="${release_dir}/.disdex-release-sha"
  [[ -f "$marker" ]] || return 1
  tr -d '[:space:]' <"$marker"
}

ops_prepare_release() {
  local target_sha="$1"
  local releases_dir="$2"
  local release_dir tmp_dir marker_sha

  ops_validate_sha "$target_sha"
  [[ "$releases_dir" == /* && "$releases_dir" != "/" ]] || ops_die "releases directory must be a non-root absolute path"
  ops_require_command git
  ops_require_command tar
  ops_fetch_exact_sha "$target_sha"

  mkdir -p "$releases_dir"
  chmod 750 "$releases_dir" 2>/dev/null || true
  release_dir="${releases_dir}/${target_sha}"

  if [[ -e "$release_dir" ]]; then
    [[ -d "$release_dir" && ! -L "$release_dir" ]] || ops_die "release path exists but is not a real directory: ${release_dir}"
    marker_sha="$(ops_release_sha "$release_dir" 2>/dev/null || true)"
    [[ "$marker_sha" == "$target_sha" ]] || ops_die "existing release marker does not match target SHA: ${release_dir}"
    [[ -f "$release_dir/package.json" ]] || ops_die "existing release is incomplete: ${release_dir}"
    printf '%s\n' "$release_dir"
    return 0
  fi

  tmp_dir="${releases_dir}/.tmp-${target_sha}-$$"
  rm -rf -- "$tmp_dir"
  mkdir -p "$tmp_dir"
  if ! git -C "$(ops_source_repo_dir)" archive --format=tar "$target_sha" | tar -xf - -C "$tmp_dir"; then
    rm -rf -- "$tmp_dir"
    ops_die "failed to materialize exact release ${target_sha}"
  fi
  printf '%s\n' "$target_sha" >"${tmp_dir}/.disdex-release-sha"
  chmod 600 "${tmp_dir}/.disdex-release-sha"
  [[ -f "$tmp_dir/package.json" ]] || {
    rm -rf -- "$tmp_dir"
    ops_die "materialized release does not contain package.json"
  }
  mv "$tmp_dir" "$release_dir"
  printf '%s\n' "$release_dir"
}

ops_link_shared_path() {
  local target="$1"
  local link_path="$2"
  [[ "$target" == /* && "$target" != "/" ]] || ops_die "shared target must be a non-root absolute path"
  [[ "$link_path" == /* && "$link_path" != "/" ]] || ops_die "shared link path must be a non-root absolute path"
  [[ -e "$target" || -L "$target" ]] || ops_die "shared target does not exist: ${target}"

  if [[ -L "$link_path" ]]; then
    local existing
    existing="$(readlink -f "$link_path" 2>/dev/null || true)"
    [[ "$existing" == "$(readlink -f "$target")" ]] || ops_die "shared link already points elsewhere: ${link_path}"
    return 0
  fi
  [[ ! -e "$link_path" ]] || ops_die "shared link path already exists and is not a symlink: ${link_path}"
  ln -s "$target" "$link_path"
}

ops_atomic_symlink() {
  local target="$1"
  local link_path="$2"
  local parent tmp
  [[ "$target" == /* && "$target" != "/" ]] || ops_die "symlink target must be a non-root absolute path"
  [[ "$link_path" == /* && "$link_path" != "/" ]] || ops_die "symlink path must be a non-root absolute path"
  [[ -d "$target" ]] || ops_die "symlink target directory does not exist: ${target}"
  parent="$(dirname "$link_path")"
  mkdir -p "$parent"
  tmp="${link_path}.tmp.$$"
  rm -f -- "$tmp"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link_path"
}

ops_link_target() {
  local link_path="$1"
  [[ -L "$link_path" ]] || return 1
  readlink -f "$link_path"
}

ops_link_release_sha() {
  local link_path="$1"
  local target
  target="$(ops_link_target "$link_path")" || return 1
  ops_release_sha "$target"
}

ops_paths_equivalent() {
  local left="$1"
  local right="$2"
  [[ "$left" == "$right" ]] && return 0
  local left_real right_real
  left_real="$(readlink -f "$left" 2>/dev/null || true)"
  right_real="$(readlink -f "$right" 2>/dev/null || true)"
  [[ -n "$left_real" && -n "$right_real" && "$left_real" == "$right_real" ]]
}

ops_control_helper() {
  local action="$1"
  shift
  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    [[ "$VPS_CONTROL_HELPER" == /* && "$VPS_CONTROL_HELPER" != "/" ]] || ops_die "VPS_CONTROL_HELPER must be a non-root absolute path"
    [[ -x "$VPS_CONTROL_HELPER" ]] || ops_die "VPS_CONTROL_HELPER is not executable: ${VPS_CONTROL_HELPER}"
    sudo -n "$VPS_CONTROL_HELPER" "$action" "$@"
    return 0
  fi
  return 127
}

ops_service_state() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    case "$manager" in
      pm2) ops_control_helper ui-state ;;
      systemd) ops_control_helper trading-state ;;
      *) ops_die "unsupported service manager: ${manager}" ;;
    esac
    return
  fi

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

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    case "$manager" in
      pm2) ops_control_helper ui-pid ;;
      systemd) ops_control_helper trading-pid ;;
      *) ops_die "unsupported service manager: ${manager}" ;;
    esac
    return
  fi

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

ops_service_working_directory() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    case "$manager" in
      pm2) ops_control_helper ui-cwd ;;
      systemd) ops_control_helper trading-cwd ;;
      *) ops_die "unsupported service manager: ${manager}" ;;
    esac
    return
  fi

  case "$manager" in
    systemd)
      systemctl show "$name" --property WorkingDirectory --value 2>/dev/null || true
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
            process.stdout.write(String(row?.pm2_env?.pm_cwd || ""));
          } catch {
            process.stdout.write("");
          }
        });
      ' "$name"
      ;;
    *)
      ops_die "unsupported service manager: ${manager}"
      ;;
  esac
}

ops_assert_service_working_directory() {
  local manager="$1"
  local name="$2"
  local expected="$3"
  local actual
  actual="$(ops_service_working_directory "$manager" "$name")"
  [[ -n "$actual" ]] || ops_die "could not determine working directory for ${name}"
  ops_paths_equivalent "$actual" "$expected" || \
    ops_die "${name} working directory is ${actual}, expected atomic current link ${expected}; complete the one-time service migration first"
}

ops_reload_ui() {
  local manager="$1"
  local name="$2"
  ops_validate_service_name "$name"

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    [[ "$manager" == "pm2" ]] || ops_die "the fixed control helper supports the inspected PM2 UI only"
    ops_control_helper ui-reload
    return
  fi

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

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    [[ "$manager" == "systemd" ]] || ops_die "the fixed control helper supports the inspected systemd trading service only"
    ops_control_helper trading-restart
    return
  fi

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

ops_run_preflight_service() {
  local template="$1"
  local target_sha="$2"
  local log_path="$3"
  local prefix instance
  ops_validate_preflight_template "$template"
  ops_validate_sha "$target_sha"
  prefix="${template%@.service}"
  instance="${prefix}@${target_sha}.service"
  ops_validate_service_name "$instance"

  if [[ -n "${VPS_CONTROL_HELPER:-}" ]]; then
    [[ "$template" == "disdex-v96-v52-preflight@.service" ]] || ops_die "the fixed control helper permits only disdex-v96-v52-preflight@.service"
    ops_control_helper preflight-start "$target_sha"
    ops_control_helper preflight-log "$target_sha" >"$log_path"
    return
  fi

  sudo -n systemctl reset-failed "$instance" >/dev/null 2>&1 || true
  sudo -n systemctl start "$instance"
  systemctl is-failed "$instance" >/dev/null 2>&1 && ops_die "authenticated no-order preflight service failed: ${instance}"
  journalctl -u "$instance" --no-pager -n 800 >"$log_path"
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

ops_run_in_dir() {
  local work_dir="$1"
  local label="$2"
  shift 2
  [[ "$work_dir" == /* && -d "$work_dir" ]] || ops_die "invalid work directory for ${label}: ${work_dir}"
  ops_log "starting: ${label}"
  (
    cd "$work_dir"
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

# Backward-compatible aliases for scripts that have not yet moved to the split layout.
ops_assert_repository() { ops_assert_source_repository; }
ops_assert_clean_tracked_tree() { ops_assert_clean_source_tree; }
ops_current_sha() { ops_source_sha; }
ops_checkout_exact_sha() {
  local target_sha="$1"
  ops_fetch_exact_sha "$target_sha"
  git -C "$(ops_source_repo_dir)" checkout --detach --force "$target_sha"
  [[ "$(ops_source_sha)" == "$target_sha" ]] || ops_die "source checkout did not reach requested SHA"
}
ops_run_in_app() {
  local label="$1"
  shift
  ops_run_in_dir "$(ops_source_repo_dir)" "$label" "$@"
}
