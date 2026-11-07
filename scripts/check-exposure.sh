#!/usr/bin/env bash
# Confere que a API não está publicada fora do cluster.
set -euo pipefail

NAMESPACE="${NAMESPACE:-calculador}"
failures=0

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }

if ! command -v kubectl >/dev/null 2>&1; then
  echo "FAIL: kubectl não encontrado no PATH" >&2
  exit 1
fi

if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  echo "FAIL: namespace ${NAMESPACE} não existe ou o cluster está inacessível" >&2
  exit 1
fi

service_ok=0
svc_type=""
if ! svc_type="$(kubectl get svc -n "$NAMESPACE" calculador-api -o jsonpath='{.spec.type}' 2>/dev/null)"; then
  fail "Service calculador-api não encontrado no namespace ${NAMESPACE}"
else
  service_ok=1
  if [[ "$svc_type" == "ClusterIP" ]]; then
    pass "Service calculador-api é ClusterIP"
  else
    fail "Service calculador-api é ${svc_type}; o esperado é ClusterIP"
  fi
fi

if [[ "$service_ok" -eq 1 ]]; then
  external_ips="$(kubectl get svc -n "$NAMESPACE" calculador-api -o jsonpath='{.spec.externalIPs}' 2>/dev/null || true)"
  if [[ -z "$external_ips" || "$external_ips" == "[]" ]]; then
    pass "Service calculador-api sem externalIPs"
  else
    fail "Service calculador-api tem externalIPs: ${external_ips}"
  fi
fi

all_svc="$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.type}{"\n"}{end}')"
exposed="$(printf '%s\n' "$all_svc" | awk '$2 != "" && $2 != "ClusterIP" { print }')"
if [[ -z "$exposed" ]]; then
  pass "nenhum Service NodePort, LoadBalancer ou ExternalName no namespace"
else
  fail "Services expostos no namespace: ${exposed}"
fi

if ! ingress_names="$(kubectl get ingress -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null)"; then
  fail "não foi possível listar Ingress no namespace ${NAMESPACE}"
elif [[ -n "$ingress_names" ]]; then
  fail "existem Ingress no namespace ${NAMESPACE}: ${ingress_names}"
else
  pass "nenhum Ingress no namespace ${NAMESPACE}"
fi

if ! kubectl get deploy -n "$NAMESPACE" calculador-api >/dev/null 2>&1; then
  fail "Deployment calculador-api não encontrado no namespace ${NAMESPACE}"
else
  host_net="$(kubectl get deploy -n "$NAMESPACE" calculador-api -o jsonpath='{.spec.template.spec.hostNetwork}')"
  if [[ "$host_net" == "true" ]]; then
    fail "hostNetwork está habilitado no Deployment"
  else
    pass "hostNetwork não está habilitado"
  fi

  host_ports="$(kubectl get deploy -n "$NAMESPACE" calculador-api -o jsonpath='{range .spec.template.spec.containers[*].ports[*]}{.hostPort}{"\n"}{end}')"
  if printf '%s\n' "$host_ports" | grep -Eq '[0-9]'; then
    fail "há hostPort no Deployment: ${host_ports}"
  else
    pass "Deployment sem hostPort"
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} checagem(ns) de exposição falharam." >&2
  exit 1
fi

echo "OK: a API não está exposta fora do cluster."
