# Lista alvos documentados com "##" no Makefile.
BEGIN { FS = "## " }
/^[a-zA-Z0-9][a-zA-Z0-9_-]*:.*## / {
  target = $1
  sub(/:.*/, "", target)
  gsub(/^[ \t]+|[ \t]+$/, "", target)
  printf "  %-18s %s\n", target, $2
}
