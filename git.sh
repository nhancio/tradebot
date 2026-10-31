#!/usr/bin/env bash
# git.sh has been folded into deploy.sh (commit + push, then platform deploy if not already covered by CI/CD).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh" "$@"
