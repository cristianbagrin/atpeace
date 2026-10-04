#!/usr/bin/env bash
# Installs the tools the real-Firefox smoke test needs into ~/.cache/at-peace/ (never into
# the repo). Idempotent: every step is skipped when its result already exists.
#
#   ~/.cache/at-peace/firefox/firefox      latest Firefox release (linux64, en-US)
#   ~/.cache/at-peace/geckodriver          geckodriver (pinned, see GECKODRIVER_VERSION)
#
# Environment (all optional):
#   AT_PEACE_CACHE        cache dir                  (default ~/.cache/at-peace)
#   GECKODRIVER_VERSION   geckodriver release        (default 0.36.0)
#   AT_PEACE_EXTRA_CA     extra root CA (PEM) Firefox must trust, e.g. a TLS-intercepting
#                         proxy CA. Default: /root/.ccr/agent-proxy-ca.crt when that file
#                         exists, otherwise none. Certificate checks are never disabled.
#   AT_PEACE_FORCE_SETUP  set to 1 to re-download everything
set -euo pipefail

CACHE="${AT_PEACE_CACHE:-$HOME/.cache/at-peace}"
GECKODRIVER_VERSION="${GECKODRIVER_VERSION:-0.36.0}"
FIREFOX_URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"
GECKODRIVER_URL="https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-linux64.tar.gz"
FIREFOX_DIR="$CACHE/firefox"
GECKODRIVER_BIN="$CACHE/geckodriver"

EXTRA_CA="${AT_PEACE_EXTRA_CA:-}"
if [ -z "$EXTRA_CA" ] && [ -f /root/.ccr/agent-proxy-ca.crt ]; then
  EXTRA_CA=/root/.ccr/agent-proxy-ca.crt
fi

log() { printf '[setup] %s\n' "$*"; }

mkdir -p "$CACHE"

if [ "${AT_PEACE_FORCE_SETUP:-0}" = "1" ]; then
  log "AT_PEACE_FORCE_SETUP=1: removing cached Firefox and geckodriver"
  rm -rf "$FIREFOX_DIR" "$GECKODRIVER_BIN"
fi

# --- Firefox ---------------------------------------------------------------------------
if [ ! -x "$FIREFOX_DIR/firefox" ]; then
  log "downloading latest Firefox release"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  # -L: download.mozilla.org redirects to the CDN. The archive is .tar.xz (older: .tar.bz2).
  curl -fsSL --retry 3 -o "$tmp/firefox.tar" "$FIREFOX_URL"
  rm -rf "$FIREFOX_DIR"
  mkdir -p "$FIREFOX_DIR"
  # `tar -xf` autodetects xz/bz2 compression.
  tar -xf "$tmp/firefox.tar" -C "$FIREFOX_DIR" --strip-components=1
  rm -rf "$tmp"
  trap - EXIT
else
  log "Firefox already installed"
fi

# --- enterprise policies: trust the proxy CA, silence first-run / update / telemetry noise
# Firefox's `Certificates.Install` policy takes ONE certificate per file (a file with several PEM
# blocks fails with NS_ERROR_ILLEGAL_VALUE, shown as "Not fully applied" in about:policies), but a CA
# bundle may hold several, as the sandbox's does. So split it into one file per certificate.
CERT_BLOCK=""
if [ -n "$EXTRA_CA" ] && [ -f "$EXTRA_CA" ]; then
  CA_DIR="$CACHE/extra-ca"
  rm -rf "$CA_DIR"
  mkdir -p "$CA_DIR"
  awk -v dir="$CA_DIR" '
    /-----BEGIN CERTIFICATE-----/ { n++; out = sprintf("%s/ca-%02d.crt", dir, n) }
    out                           { print > out }
    /-----END CERTIFICATE-----/   { close(out); out = "" }
  ' "$EXTRA_CA"
  CERT_LIST=""
  for f in "$CA_DIR"/ca-*.crt; do
    CERT_LIST="${CERT_LIST:+$CERT_LIST,}\"$f\""
  done
  CERT_BLOCK=",\"Certificates\":{\"Install\":[$CERT_LIST]}"
  log "policies.json: trusting $(ls "$CA_DIR" | wc -l) certificate(s) from $EXTRA_CA"
else
  log "policies.json: no extra CA configured"
fi
mkdir -p "$FIREFOX_DIR/distribution"
cat > "$FIREFOX_DIR/distribution/policies.json" <<EOF
{
  "policies": {
    "DisableAppUpdate": true,
    "DisableTelemetry": true,
    "DisableFirefoxStudies": true,
    "DontCheckDefaultBrowser": true,
    "NoDefaultBookmarks": true,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": ""${CERT_BLOCK}
  }
}
EOF

# --- geckodriver -----------------------------------------------------------------------
if [ ! -x "$GECKODRIVER_BIN" ]; then
  log "downloading geckodriver v${GECKODRIVER_VERSION}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/geckodriver.tar.gz" "$GECKODRIVER_URL"
  tar -xzf "$tmp/geckodriver.tar.gz" -C "$tmp"
  mv "$tmp/geckodriver" "$GECKODRIVER_BIN"
  chmod +x "$GECKODRIVER_BIN"
  rm -rf "$tmp"
  trap - EXIT
else
  log "geckodriver already installed"
fi

# --- shared libraries ------------------------------------------------------------------
# Even headless Firefox links against GTK and friends. If any are missing, install them
# (Debian/Ubuntu only; elsewhere print what is missing and fail).
missing_libs() {
  ldd "$FIREFOX_DIR/firefox-bin" 2>/dev/null | awk '/not found/ {print $1}'
}

missing="$(missing_libs || true)"
if [ -n "$missing" ]; then
  log "missing shared libraries: $(echo "$missing" | tr '\n' ' ')"
  if command -v apt-get >/dev/null 2>&1; then
    SUDO=""
    if [ "$(id -u)" != "0" ]; then SUDO="sudo"; fi
    log "installing system libraries with apt-get"
    $SUDO apt-get update -qq
    # Names differ between Ubuntu releases (t64 suffix on 24.04), so try both spellings.
    for pkg in libgtk-3-0 libdbus-glib-1-2 libasound2 libx11-xcb1 libxtst6 libxt6 libxcomposite1 \
               libxdamage1 libxfixes3 libxrandr2 libxcursor1 libxi6 libpci3 libegl1 libpulse0 \
               fonts-liberation; do
      $SUDO apt-get install -y -qq "$pkg" >/dev/null 2>&1 \
        || $SUDO apt-get install -y -qq "${pkg}t64" >/dev/null 2>&1 \
        || log "could not install $pkg (continuing)"
    done
    missing="$(missing_libs || true)"
  fi
  if [ -n "$missing" ]; then
    log "ERROR: still missing: $(echo "$missing" | tr '\n' ' ')"
    exit 1
  fi
fi

log "firefox:     $("$FIREFOX_DIR/firefox" --version 2>/dev/null || echo 'cannot run')"
log "geckodriver: $("$GECKODRIVER_BIN" --version 2>/dev/null | head -1 || echo 'cannot run')"
log "ready ($CACHE)"
