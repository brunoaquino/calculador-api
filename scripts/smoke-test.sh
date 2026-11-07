#!/usr/bin/env bash
# Testa a API de dentro do cluster, a partir de outro namespace.
set -euo pipefail

failures=0

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }

snippet() {
  printf '%s' "$1" | tr '\n' ' ' | cut -c 1-300
}

parse_status_body() {
  local raw="$1"
  raw="${raw//$'\r'/}"
  STATUS="${raw##*$'\n'STATUS:}"
  BODY="${raw%$'\n'STATUS:*}"
  BODY="${BODY%$'\n'}"
}

parse_full() {
  local raw="$1"
  raw="${raw//$'\r'/}"
  STATUS="${raw##*$'\n'STATUS:}"
  local rest="${raw%$'\n'STATUS:*}"
  HEADERS="${rest%%$'\n\n'*}"
  BODY="${rest#*$'\n\n'}"
  BODY="${BODY%$'\n'}"
}

body_has_result() {
  local body="$1"
  local expected="$2"
  printf '%s' "$body" | grep -Eq '"result"[[:space:]]*:[[:space:]]*'"${expected}"'(\.0+)?([[:space:]]*[},]|$)'
}

body_has_error_contract() {
  local body="$1"
  local field
  for field in statusCode error message traceId path timestamp; do
    printf '%s' "$body" | grep -Eq "\"${field}\"" || return 1
  done
  printf '%s' "$body" | grep -Eq '"statusCode"[[:space:]]*:[[:space:]]*400([^0-9]|$)'
}

self_test() {
  local raw
  raw=$'{"result":5}\nSTATUS:200'
  parse_status_body "$raw"
  if [[ "$STATUS" == "200" && "$BODY" == '{"result":5}' ]]; then
    pass "parser de status e corpo"
  else
    fail "parser de status e corpo (status=${STATUS} body=${BODY})"
  fi

  if body_has_result '{"result":5}' 5 \
    && body_has_result '{"result": 12}' 12 \
    && body_has_result '{"result":5.0}' 5 \
    && ! body_has_result '{"result":15}' 5 \
    && ! body_has_result '{"result":51}' 5; then
    pass "comparação do campo result"
  else
    fail "comparação do campo result"
  fi

  raw=$'HTTP/1.1 200 OK\r\nx-trace-id: smoke-trace-1\r\ncontent-type: application/json\r\n\r\n{"result":5}\nSTATUS:200'
  parse_full "$raw"
  if [[ "$STATUS" == "200" && "$BODY" == '{"result":5}' ]] \
    && printf '%s\n' "$HEADERS" | grep -Eqi '^x-trace-id:[[:space:]]*smoke-trace-1[[:space:]]*$'; then
    pass "parser de header x-trace-id"
  else
    fail "parser de header x-trace-id (status=${STATUS} body=${BODY})"
  fi

  if body_has_error_contract '{"statusCode":400,"error":"Bad Request","message":"divisão por zero","traceId":"abc","path":"/api/div","timestamp":"2026-11-06T00:00:00.000Z"}' \
    && ! body_has_error_contract '{"statusCode":4000,"error":"x","message":"x","traceId":"x","path":"/","timestamp":"t"}'; then
    pass "contrato do corpo 400"
  else
    fail "contrato do corpo 400"
  fi

  if [[ "$failures" -gt 0 ]]; then
    exit 1
  fi
  echo "self-test ok"
}

pod_overrides() {
  cat <<JSON
{
  "spec": {
    "automountServiceAccountToken": false,
    "activeDeadlineSeconds": 300,
    "terminationGracePeriodSeconds": 1,
    "securityContext": {
      "runAsNonRoot": true,
      "runAsUser": 65534,
      "runAsGroup": 65534,
      "fsGroup": 65534,
      "seccompProfile": { "type": "RuntimeDefault" }
    },
    "containers": [
      {
        "name": "${POD_NAME}",
        "image": "${CURL_IMAGE}",
        "imagePullPolicy": "IfNotPresent",
        "command": ["sleep", "300"],
        "resources": {
          "requests": { "cpu": "10m", "memory": "16Mi" },
          "limits": { "cpu": "200m", "memory": "64Mi" }
        },
        "env": [{ "name": "HOME", "value": "/tmp" }],
        "securityContext": {
          "allowPrivilegeEscalation": false,
          "readOnlyRootFilesystem": true,
          "runAsNonRoot": true,
          "runAsUser": 65534,
          "runAsGroup": 65534,
          "capabilities": { "drop": ["ALL"] },
          "seccompProfile": { "type": "RuntimeDefault" }
        },
        "volumeMounts": [{ "name": "tmp", "mountPath": "/tmp" }]
      }
    ],
    "volumes": [{ "name": "tmp", "emptyDir": { "sizeLimit": "16Mi" } }]
  }
}
JSON
}

render_pod() {
  kubectl run "$POD_NAME" \
    --namespace "$CLIENT_NAMESPACE" \
    --image "$CURL_IMAGE" \
    --restart=Never \
    --labels "app.kubernetes.io/name=calculador-smoke" \
    --overrides "$(pod_overrides)" \
    --dry-run=client \
    --output=yaml \
    --command -- sleep 300
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

NAMESPACE="${NAMESPACE:-calculador}"
CLIENT_NAMESPACE="${CLIENT_NAMESPACE:-default}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.23.0}"
BASE_URL="${BASE_URL:-http://calculador-api.${NAMESPACE}.svc.cluster.local:8000}"
POD_NAME="${POD_NAME:-calculador-smoke-$(date +%s)}"
TRACE_ID="${TRACE_ID:-smoke-trace-1}"

if [[ "${1:-}" == "--render-pod" ]]; then
  render_pod
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  local rc=$?
  kubectl delete pod -n "$CLIENT_NAMESPACE" "$POD_NAME" \
    --ignore-not-found=true --wait=true --timeout=30s >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT

echo "Cliente: namespace ${CLIENT_NAMESPACE}, pod ${POD_NAME}"
echo "API: ${BASE_URL}"

bash "${SCRIPT_DIR}/check-exposure.sh"

if [[ "$CLIENT_NAMESPACE" == "$NAMESPACE" ]]; then
  echo "FAIL: o cliente não pode rodar no namespace ${NAMESPACE}." >&2
  echo "O egress desse namespace é negado. Use CLIENT_NAMESPACE=default." >&2
  exit 1
fi

if ! kubectl get namespace "$CLIENT_NAMESPACE" >/dev/null 2>&1; then
  echo "FAIL: namespace cliente ${CLIENT_NAMESPACE} não existe" >&2
  exit 1
fi

kubectl delete pod -n "$CLIENT_NAMESPACE" "$POD_NAME" --ignore-not-found=true --wait=true >/dev/null 2>&1 || true

kubectl run "$POD_NAME" \
  --namespace "$CLIENT_NAMESPACE" \
  --image "$CURL_IMAGE" \
  --restart=Never \
  --labels "app.kubernetes.io/name=calculador-smoke" \
  --overrides "$(pod_overrides)" \
  --command -- sleep 300 >/dev/null

if ! kubectl wait --namespace "$CLIENT_NAMESPACE" --for=condition=Ready "pod/${POD_NAME}" --timeout=180s; then
  echo "FAIL: pod ${POD_NAME} não ficou Ready" >&2
  kubectl describe pod -n "$CLIENT_NAMESPACE" "$POD_NAME" >&2 || true
  exit 1
fi

fetch() {
  local path="$1"
  shift
  kubectl exec -n "$CLIENT_NAMESPACE" "$POD_NAME" -- \
    curl -sS --max-time 15 -w '\nSTATUS:%{http_code}' "$@" \
    "${BASE_URL}${path}"
}

expect_result() {
  local name="$1"
  local path="$2"
  local want_status="$3"
  local want_result="$4"
  local raw
  if ! raw="$(fetch "$path" -H "Accept: application/json")"; then
    fail "${name} (sem resposta)"
    return 0
  fi
  parse_status_body "$raw"
  if [[ "$STATUS" != "$want_status" ]]; then
    fail "${name} (HTTP ${STATUS}, esperado ${want_status}) $(snippet "$BODY")"
    return 0
  fi
  if ! body_has_result "$BODY" "$want_result"; then
    fail "${name} (corpo inesperado: $(snippet "$BODY"))"
    return 0
  fi
  pass "$name"
  return 0
}

expect_error() {
  local name="$1"
  local path="$2"
  local raw
  if ! raw="$(fetch "$path")"; then
    fail "${name} (sem resposta)"
    return 0
  fi
  parse_status_body "$raw"
  if [[ "$STATUS" != "400" ]]; then
    fail "${name} (HTTP ${STATUS}, esperado 400) $(snippet "$BODY")"
    return 0
  fi
  if ! body_has_error_contract "$BODY"; then
    fail "${name} (corpo 400 fora do contrato: $(snippet "$BODY"))"
    return 0
  fi
  pass "$name"
  return 0
}

expect_trace() {
  local raw
  if ! raw="$(fetch "/api/sum?term_one=2&term_two=3" -D - -H "x-trace-id: ${TRACE_ID}")"; then
    fail "correlação do traceId (sem resposta)"
    return 0
  fi
  parse_full "$raw"
  if [[ "$STATUS" != "200" ]] || ! body_has_result "$BODY" 5; then
    fail "correlação do traceId (HTTP ${STATUS}, corpo $(snippet "$BODY"))"
    return 0
  fi
  if ! printf '%s\n' "$HEADERS" | grep -Eqi "^x-trace-id:[[:space:]]*${TRACE_ID}[[:space:]]*$"; then
    fail "header x-trace-id não ecoou ${TRACE_ID} ($(snippet "$HEADERS"))"
    return 0
  fi
  pass "header x-trace-id ecoa ${TRACE_ID}"
  return 0
}

expect_health() {
  local raw
  if ! raw="$(fetch "/health/ready")"; then
    fail "GET /health/ready (sem resposta)"
    return 0
  fi
  parse_status_body "$raw"
  if [[ "$STATUS" != "200" ]] || ! printf '%s' "$BODY" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    fail "GET /health/ready (HTTP ${STATUS}, corpo $(snippet "$BODY"))"
    return 0
  fi
  pass "GET /health/ready"
  return 0
}

expect_health
expect_result "GET /api/sum 2+3=5" "/api/sum?term_one=2&term_two=3" 200 5
expect_result "GET /api/sub 4-1=3" "/api/sub?term_one=4&term_two=1" 200 3
expect_result "GET /api/mul 3*4=12" "/api/mul?term_one=3&term_two=4" 200 12
expect_result "GET /api/div 10/2=5" "/api/div?term_one=10&term_two=2" 200 5
expect_error "GET /api/div por zero" "/api/div?term_one=10&term_two=0"
expect_error "GET /api/sum entrada inválida" "/api/sum?term_one=2&term_two=abc"
expect_trace

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} verificação(ões) falharam." >&2
  exit 1
fi

echo "Smoke test ok."
