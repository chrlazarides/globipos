#!/bin/bash
set -e
pnpm install --frozen-lockfile
# drizzle-kit can print a TTY/rename error and still exit with status 0.
# Never report setup as successful if the schema was not actually applied.
if ! push_output=$(pnpm --filter @workspace/db run push 2>&1); then
  printf '%s\n' "$push_output"
  exit 1
fi
printf '%s\n' "$push_output"
if grep -Eq '^Error:|Interactive prompts require a TTY' <<< "$push_output"; then
  echo "Database schema push did not complete; resolve the schema diff before continuing." >&2
  exit 1
fi
