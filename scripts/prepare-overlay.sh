#!/usr/bin/env bash
# Copia k8s/ para um diretório temporário, troca a imagem e grava um patch de deploy.
# Imprime o diretório na stdout. Quem chama é dono de apagá-lo.
# Não altera os arquivos versionados.
#
# IMAGE:
#   repo:tag              -> newName + newTag, sem digest (mesmo que o original tenha)
#   repo@sha256:...       -> newName + digest
#   repo:tag@sha256:...   -> newName + newTag + digest (no kustomize o digest vence)
set -euo pipefail

if [[ -z "${IMAGE:-}" ]]; then
  echo "IMAGE é obrigatória (exemplo: ghcr.io/org/calculador-api:1.0.0)" >&2
  exit 1
fi
if [[ -z "${K8S_DIR:-}" || ! -f "${K8S_DIR}/kustomization.yaml" ]]; then
  echo "K8S_DIR precisa apontar para o diretório k8s/" >&2
  exit 1
fi

PULL_SECRET="${PULL_SECRET:-}"
DEPLOYED_AT="${DEPLOYED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

tmp="$(mktemp -d)"
cleanup_fail() {
  local rc=$?
  if [[ "$rc" -ne 0 ]]; then
    rm -rf "$tmp"
  fi
}
trap cleanup_fail EXIT

cp -R "${K8S_DIR}/." "${tmp}/"

# Separa nome, tag e digest.
# localhost:5000/calculador-api:1.0.0 -> nome localhost:5000/calculador-api, tag 1.0.0
name="$IMAGE"
digest=""
tag=""
if [[ "$name" == *"@"* ]]; then
  digest="${name#*@}"
  name="${name%%@*}"
fi
base="${name##*/}"
if [[ "$base" == *:* ]]; then
  tag="${base##*:}"
  base="${base%%:*}"
  if [[ "$name" == */* ]]; then
    name="${name%/*}/${base}"
  else
    name="$base"
  fi
fi
if [[ -z "$digest" && -z "$tag" ]]; then
  tag="latest"
fi

yaml_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

quoted_name="$(yaml_quote "$name")"
quoted_tag="$(yaml_quote "$tag")"
quoted_digest="$(yaml_quote "$digest")"

kustomization="${tmp}/kustomization.yaml"
if ! awk_out="$(
  NAME_Q="$quoted_name" TAG_Q="$quoted_tag" TAG_RAW="$tag" DIGEST_Q="$quoted_digest" DIGEST_RAW="$digest" awk '
    BEGIN { seen = 0; skipping = 0 }
    /^images:[[:space:]]*$/ && !seen {
      seen = 1
      skipping = 1
      print "images:"
      print "  - name: calculador-api"
      print "    newName: " ENVIRON["NAME_Q"]
      if (ENVIRON["TAG_RAW"] != "") {
        print "    newTag: " ENVIRON["TAG_Q"]
      }
      if (ENVIRON["DIGEST_RAW"] != "") {
        print "    digest: " ENVIRON["DIGEST_Q"]
      }
      next
    }
    skipping {
      if ($0 ~ /^[^[:space:]#]/) {
        skipping = 0
        print
      }
      next
    }
    { print }
    END { if (!seen) exit 2 }
  ' "$kustomization"
)"; then
  echo "Não encontrei o bloco images: em ${K8S_DIR}/kustomization.yaml" >&2
  exit 1
fi
printf '%s\n' "$awk_out" > "$kustomization"

if grep -q '^patches:' "$kustomization"; then
  echo "kustomization.yaml já contém patches; não sei mesclar com o patch de deploy." >&2
  exit 1
fi

cat >> "$kustomization" <<'EOF'
patches:
  - path: deploy-patch.yaml
    target:
      group: apps
      version: v1
      kind: Deployment
      name: calculador-api
EOF

{
  echo "apiVersion: apps/v1"
  echo "kind: Deployment"
  echo "metadata:"
  echo "  name: calculador-api"
  echo "spec:"
  echo "  template:"
  echo "    metadata:"
  echo "      annotations:"
  printf '        calculador.dev/deployed-at: %s\n' "$(yaml_quote "$DEPLOYED_AT")"
  if [[ -n "$PULL_SECRET" ]]; then
    echo "    spec:"
    echo "      imagePullSecrets:"
    printf '        - name: %s\n' "$(yaml_quote "$PULL_SECRET")"
  fi
} > "${tmp}/deploy-patch.yaml"

trap - EXIT
printf '%s\n' "$tmp"
