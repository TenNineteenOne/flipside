#!/bin/sh
# Re-checks the decision rules for one artist (see SKILL.md).
#   check.sh [repo-root]     default: the repo this skill lives in
# 1. model:       TLC checks every rule of Decisions.tla in each config and
#                 compares the result with expected.txt
# 2. conformance: the model's tables against the real SQL, routes and client
# 3. replay:      each known finding against the real code
# Exit 0 only if all three match what is recorded.
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "${1:-$here/../../..}" && pwd)
cache=${FLIPSIDE_FORMAL_CACHE:-$HOME/.cache/flipside-formal}
export FLIPSIDE_REPO="$repo" FLIPSIDE_FORMAL_CACHE="$cache"

die() { echo "check.sh: $*" >&2; exit 2; }

# Tools, pinned. TLA2TOOLS (and JAVA) override the mise install.
TLC_SPEC='http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4'
JAVA_SPEC='java@temurin-25'
PG_VERSION='17.5.0-beta.15'

work=$(mktemp -d) || die "mktemp failed"
trap 'rm -rf -- "$work"' EXIT
cp "$here"/*.tla "$here"/*.cfg "$work"/ || die "cannot copy the model"
cd "$work" || die "cannot enter $work"

if [ -z "${TLA2TOOLS:-}" ]; then
  command -v mise >/dev/null || die "mise is not on PATH (or set TLA2TOOLS to tla2tools.jar and JAVA to a java 11+ binary)"
  export MISE_CEILING_PATHS="$work"
  mise where "$TLC_SPEC" >/dev/null 2>&1 && mise which java --tool "$JAVA_SPEC" >/dev/null 2>&1 \
    || mise install "$JAVA_SPEC" "$TLC_SPEC" || die "mise could not install TLC and Java"
  TLA2TOOLS=$(mise where "$TLC_SPEC")/tla2tools.jar
  JAVA=$(mise which java --tool "$JAVA_SPEC")
fi
JAVA=${JAVA:-java}

if [ ! -d "$cache/node_modules/embedded-postgres" ]; then
  mkdir -p "$cache" && cd "$cache" || die "cannot create $cache"
  [ -f package.json ] || echo '{"name":"flipside-formal-cache","private":true}' > package.json
  npm install --no-audit --no-fund --save-exact "embedded-postgres@$PG_VERSION" >/dev/null || die "npm could not install embedded-postgres"
  # The platform package's own postinstall (npm may hold install scripts back): restores the library symlinks.
  for d in "$cache"/node_modules/@embedded-postgres/*/; do (cd "$d" && node scripts/hydrate-symlinks.js); done
  cd "$work" || die "cannot enter $work"
fi
[ -x "$repo/node_modules/.bin/vitest" ] || die "$repo has no node_modules (run npm ci there)"

status=0

# tlc <name> <config-file> <module>: output in $work/<name>.out
tlc() {
  "$JAVA" -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers auto -config "$2" -metadir "$work/states-$1" "$3" > "$work/$1.out" 2>&1
}

# verdict <name>: holds | broken:<rule> | error
verdict() {
  if grep -q "Model checking completed. No error has been found" "$work/$1.out"; then echo holds
  elif grep -q "^Error: Invariant .* is violated" "$work/$1.out"; then
    echo "broken:$(sed -n 's/^Error: Invariant \(.*\) is violated.*/\1/p' "$work/$1.out" | head -1)"
  else echo error; fi
}

report() { # config rule variant expected got
  if [ "$4" = "$5" ]; then
    printf '  %-9s %-13s %-24s %s\n' "$([ "$4" = holds ] && echo ok || { [ "$3" = code ] && echo finding || echo ok; })" "$1" "$2" "$4$([ "$3" = code ] || echo " in variant $3, as it must")"
  else
    printf '  %-9s %-13s %-24s expected %s, got %s  (TLC output: %s)\n' CHANGED "$1" "$2" "$4" "$5" "$6"
    status=1
  fi
}

echo "1. model (TLC)"
rows=$(grep -v '^#' "$here/expected.txt" | awk 'NF >= 3 { print $1, $2, $3, (NF >= 4 ? $4 : "code") }')
[ -n "$rows" ] || die "expected.txt has no rows"
for config in $(echo "$rows" | awk '{ print $1 }' | sort -u); do
  [ -f "$config.cfg" ] || die "expected.txt names $config, but there is no $config.cfg"
  grep -v '^INVARIANT' "$config.cfg" > "base-$config.cfg"
  # Every rule expected to hold, in one run.
  holds=$(echo "$rows" | awk -v c="$config" '$1 == c && $3 == "holds" && $4 == "code" { print $2 }')
  if [ -n "$holds" ]; then
    { cat "base-$config.cfg"; for r in $holds; do echo "INVARIANT $r"; done; } > "run-$config-holds.cfg"
    tlc "$config-holds" "run-$config-holds.cfg" Decisions.tla
    got=$(verdict "$config-holds")
    for r in $holds; do
      case $got in
        holds) report "$config" "$r" code holds holds "" ;;
        "broken:$r") report "$config" "$r" code holds broken "$work/$config-holds.out"; trap - EXIT ;;
        broken:*) echo "  (not checked: $config $r, because ${got#broken:} broke first)"; status=1 ;;
        *) report "$config" "$r" code holds "a TLC error" "$work/$config-holds.out"; trap - EXIT ;;
      esac
    done
  fi
  # Every rule expected to break, one run each (TLC stops at the first break).
  echo "$rows" | awk -v c="$config" '$1 == c && $3 == "broken" { print $2, $4 }' > "broken-$config.txt"
  while read -r r variant; do
    { sed "s/Variant = \"code\"/Variant = \"$variant\"/" "base-$config.cfg"; echo "INVARIANT $r"; } > "run-$config-$r-$variant.cfg"
    tlc "$config-$r-$variant" "run-$config-$r-$variant.cfg" Decisions.tla
    got=$(verdict "$config-$r-$variant")
    case $got in
      "broken:$r") report "$config" "$r" "$variant" broken broken "" ;;
      holds) report "$config" "$r" "$variant" broken holds "$work/$config-$r-$variant.out"; trap - EXIT ;;
      *) report "$config" "$r" "$variant" broken "a TLC error" "$work/$config-$r-$variant.out"; trap - EXIT ;;
    esac
  done < "broken-$config.txt"
done

echo "2. conformance and 3. replay (real SQL, routes, client)"
tlc tables tables.cfg Tables.tla
grep -q "Model checking completed. No error has been found" "$work/tables.out" || { echo "  Tables.tla did not run: $work/tables.out"; trap - EXIT; status=1; }
export FLIPSIDE_FORMAL_TABLES="$work/tables.out"
(cd "$repo" && node_modules/.bin/vitest run --config "$here/harness/vitest.config.mts" 2>&1) > "$work/vitest.out"
# Read the summary, not the exit code: embedded-postgres's exit hook ends the process with 0 even when tests fail.
if grep -Eq '^ +Test Files +[0-9]+ passed \([0-9]+\)$' "$work/vitest.out" && grep -Eq '^ +Tests +[0-9]+ passed \([0-9]+\)$' "$work/vitest.out"; then
  grep -E "Test Files|Tests " "$work/vitest.out" | sed 's/^/  /'
else
  grep -vE '^\[(feedback|saves|dismiss)' "$work/vitest.out" | tail -60
  status=1
fi

if [ $status -eq 0 ]; then echo "RESULT: unchanged. Rules marked 'finding' are known breaks recorded in SKILL.md, not new ones."
else echo "RESULT: CHANGED. Read SKILL.md, 'When a result changes'."; fi
exit $status
