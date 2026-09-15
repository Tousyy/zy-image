#!/bin/bash
set -e
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$script_dir/install-local.sh"
