#!/usr/bin/env bash
(
  set -u

  # required env
  if [ -z "${PHASE8_BASE:-}" ]; then
    echo "[phase8] ERROR: PHASE8_BASE is required"
    exit 64
  fi
  if [ -z "${PHASE8_USER_ID:-}" ]; then
    echo "[phase8] ERROR: PHASE8_USER_ID is required"
    exit 64
  fi

  PHASE8_OUT="${PHASE8_OUT:-PHASE8_READINESS_REPORT.md}"
  PHASE8_TIMEOUT_MS="${PHASE8_TIMEOUT_MS:-20000}"
  BASE="${PHASE8_BASE%/}"

  echo "== Phase8 preflight =="
  echo "BASE=$BASE"
  echo "USER_ID=$PHASE8_USER_ID"
  echo "OUT=$PHASE8_OUT"
  echo "TIMEOUT_MS=$PHASE8_TIMEOUT_MS"
  echo

  echo "== Connectivity check =="
  curl -iS --max-time 20 "$BASE/api/system/version"
  CURL_CODE=$?
  if [ $CURL_CODE -ne 0 ]; then
    echo "[phase8] Connectivity failed (curl exit=$CURL_CODE)."
    exit $CURL_CODE
  fi
  echo

  echo "== Readiness check =="
  PHASE8_TIMEOUT_MS="$PHASE8_TIMEOUT_MS" \
  node scripts/phase8-readiness-check.mjs \
    --base "$BASE" \
    --user-id "$PHASE8_USER_ID" \
    --out "$PHASE8_OUT"
  NODE_CODE=$?

  echo
  echo "== Done =="
  echo "report=$PHASE8_OUT"
  echo "exit_code=$NODE_CODE"
  exit $NODE_CODE
)
