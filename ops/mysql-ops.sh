#!/usr/bin/env bash
#
# mysql-ops.sh — provisions and controls a PRIVATE, LOCAL-ONLY MySQL server
# for the operational (ops_*) data plane only.
#
# This is NOT the scientific data source. It must never point at the
# read-only scientific SQLite/MYSQL_URL data used elsewhere in this repo
# (see src/lib/db.ts). It binds to 127.0.0.1 only (loopback), never listens
# on the shared port 3306 (which belongs to another user's mysqld on this
# host), and lives entirely under /scratch/vsetlur so it can never collide
# with, or be confused for, the ai-ale-dev conda env that runs the
# production viewer (port 3457) and the live ops viewer (port 3458).
#
# Subcommands: install | init | start | stop | status | client | url
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment)
# ---------------------------------------------------------------------------
MYSQL_HOME="${MYSQL_HOME:-/scratch/vsetlur/mysql-ops}"
MYSQL_ENV="${MYSQL_ENV:-ai-ale-mysql}"
MYSQL_PORT="${MYSQL_PORT:-13306}"
MYSQL_DB="aiale_ops"
MYSQL_USER="aiale_ops"

SOCKET="$MYSQL_HOME/mysql.sock"
DATADIR="$MYSQL_HOME/data"
PIDFILE="$MYSQL_HOME/mysql.pid"
ERRLOG="$MYSQL_HOME/mysql.err"
PASSFILE="$MYSQL_HOME/ops-db-password"

CONDA_SH="/scratch/vsetlur/anaconda3/etc/profile.d/conda.sh"

# ---------------------------------------------------------------------------
# Hard refusals — checked before any subcommand runs
# ---------------------------------------------------------------------------
refuse() {
  echo "REFUSED: $1" >&2
  exit 2
}

if [ "$(id -u)" -eq 0 ]; then
  refuse "must not be run as root."
fi

if [ "$MYSQL_PORT" = "3306" ]; then
  refuse "MYSQL_PORT=3306 is the shared port already in use by another user's mysqld on this host. Choose a different port (default 13306)."
fi

if [ "$MYSQL_ENV" = "ai-ale-dev" ] || [ "$MYSQL_ENV" = "ai-ale-viewer" ]; then
  refuse "MYSQL_ENV=$MYSQL_ENV is a protected conda env (runs the production/live viewer). MySQL must live in its own env (default ai-ale-mysql)."
fi

case "$MYSQL_HOME" in
  /scratch/vsetlur/*) ;;
  *) refuse "MYSQL_HOME=$MYSQL_HOME must start with /scratch/vsetlur/" ;;
esac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
activate_env() {
  # shellcheck disable=SC1090
  source "$CONDA_SH"
  conda activate "$MYSQL_ENV"
  export MYSQL_BASEDIR="$CONDA_PREFIX"
}

require_env_exists() {
  # shellcheck disable=SC1090
  source "$CONDA_SH"
  if ! conda env list | awk '{print $1}' | grep -qx "$MYSQL_ENV"; then
    echo "Conda env '$MYSQL_ENV' does not exist. Run 'ops/mysql-ops.sh install' first." >&2
    exit 1
  fi
  activate_env
}

is_running() {
  if [ -S "$SOCKET" ] && mysqladmin --socket="$SOCKET" -uroot ping >/dev/null 2>&1; then
    return 0
  fi
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

wait_for_ready() {
  local tries=30
  while [ "$tries" -gt 0 ]; do
    if [ -S "$SOCKET" ] && mysqladmin --socket="$SOCKET" -uroot ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  echo "mysqld did not become ready within 30s. Last 20 lines of $ERRLOG:" >&2
  tail -n 20 "$ERRLOG" >&2 2>/dev/null || true
  return 1
}

do_start() {
  if is_running; then
    echo "mysqld is already running (socket=$SOCKET, port=$MYSQL_PORT)."
    return 0
  fi
  mkdir -p "$MYSQL_HOME"
  nohup mysqld \
    --no-defaults \
    --user="$USER" \
    --basedir="$MYSQL_BASEDIR" \
    --datadir="$DATADIR" \
    --socket="$SOCKET" \
    --bind-address=127.0.0.1 \
    --port="$MYSQL_PORT" \
    --pid-file="$PIDFILE" \
    --log-error="$ERRLOG" \
    >>"$ERRLOG" 2>&1 &
  disown || true
  wait_for_ready
  echo "mysqld started (socket=$SOCKET, port=$MYSQL_PORT, datadir=$DATADIR)."
}

# percent-encode a string for use in a URL (RFC 3986 unreserved chars pass through)
urlencode() {
  local s="$1" out="" c
  local i
  for (( i=0; i<${#s}; i++ )); do
    c="${s:$i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
cmd_install() {
  # shellcheck disable=SC1090
  source "$CONDA_SH"
  if conda env list | awk '{print $1}' | grep -qx "$MYSQL_ENV"; then
    echo "Conda env '$MYSQL_ENV' already installed."
    exit 0
  fi
  # conda-forge's mysql-server package ships the server only, no client
  # binaries (mysql, mysqladmin). Install mysql-client in the same command
  # so 'init' can run without a separate manual install step.
  conda create -y -n "$MYSQL_ENV" -c conda-forge mysql-server mysql-client
  activate_env
  local bin="$CONDA_PREFIX/bin"
  local missing=""
  for tool in mysqld mysql mysqladmin; do
    if [ ! -x "$bin/$tool" ]; then
      missing="$missing $tool"
    fi
  done
  if [ -n "$missing" ]; then
    echo "Install verification failed: missing binaries in $bin:$missing" >&2
    exit 1
  fi
  echo "Installed. mysqld: $(command -v mysqld)"
  echo "Installed. mysql:  $(command -v mysql)"
  echo "Installed. mysqladmin: $(command -v mysqladmin)"
}

cmd_init() {
  require_env_exists

  mkdir -p "$MYSQL_HOME"
  chmod 700 "$MYSQL_HOME"

  if [ ! -f "$PASSFILE" ]; then
    openssl rand -hex 24 > "$PASSFILE"
    chmod 600 "$PASSFILE"
  fi
  local password
  password="$(cat "$PASSFILE")"

  if [ ! -d "$DATADIR" ] || [ -z "$(ls -A "$DATADIR" 2>/dev/null)" ]; then
    mkdir -p "$DATADIR"
    mysqld --initialize-insecure --datadir="$DATADIR" --basedir="$MYSQL_BASEDIR"
  fi

  do_start

  # Bootstrap DB + users. Password passed via stdin heredoc, never on the
  # command line (which would be visible in `ps`).
  mysql --socket="$SOCKET" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS ${MYSQL_DB} CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${password}';
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'127.0.0.1' IDENTIFIED BY '${password}';
ALTER USER '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${password}';
ALTER USER '${MYSQL_USER}'@'127.0.0.1' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON ${MYSQL_DB}.* TO '${MYSQL_USER}'@'localhost';
GRANT ALL PRIVILEGES ON ${MYSQL_DB}.* TO '${MYSQL_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

  echo "init complete: database=${MYSQL_DB} user=${MYSQL_USER} (password in $PASSFILE)."
}

cmd_start() {
  require_env_exists
  do_start
}

cmd_stop() {
  require_env_exists
  if ! is_running; then
    echo "mysqld is not running."
    exit 0
  fi
  if [ -S "$SOCKET" ] && mysqladmin --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1; then
    :
  fi
  local tries=20
  while [ "$tries" -gt 0 ] && is_running; do
    sleep 1
    tries=$((tries - 1))
  done
  if is_running && [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" >/dev/null 2>&1 || true
    tries=10
    while [ "$tries" -gt 0 ] && kill -0 "$pid" >/dev/null 2>&1; do
      sleep 1
      tries=$((tries - 1))
    done
  fi
  if is_running; then
    echo "Failed to stop mysqld." >&2
    exit 1
  fi
  echo "mysqld stopped."
}

cmd_status() {
  require_env_exists
  if is_running; then
    echo "status: running"
  else
    echo "status: stopped"
  fi
  echo "port: $MYSQL_PORT"
  echo "socket: $SOCKET"
  echo "datadir: $DATADIR"
  echo "conda env: $MYSQL_ENV ($CONDA_PREFIX)"
}

cmd_client() {
  require_env_exists
  exec mysql --socket="$SOCKET" -uroot "$@"
}

cmd_url() {
  require_env_exists
  if [ ! -f "$PASSFILE" ]; then
    echo "Password file $PASSFILE not found. Run 'ops/mysql-ops.sh init' first." >&2
    exit 1
  fi
  local password encoded
  password="$(cat "$PASSFILE")"
  encoded="$(urlencode "$password")"
  echo "WARNING: the following line contains a secret. Redirect it only into .env.live (gitignored); never paste it elsewhere." >&2
  echo "mysql://${MYSQL_USER}:${encoded}@127.0.0.1:${MYSQL_PORT}/${MYSQL_DB}"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
SUBCOMMAND="${1:-}"
[ $# -gt 0 ] && shift || true

case "$SUBCOMMAND" in
  install) cmd_install "$@" ;;
  init)    cmd_init "$@" ;;
  start)   cmd_start "$@" ;;
  stop)    cmd_stop "$@" ;;
  status)  cmd_status "$@" ;;
  client)  cmd_client "$@" ;;
  url)     cmd_url "$@" ;;
  *)
    echo "Usage: $0 {install|init|start|stop|status|client|url}" >&2
    exit 2
    ;;
esac
