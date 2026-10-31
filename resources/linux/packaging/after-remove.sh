#!/bin/bash
# Remove only our install-owned symlink; preserve any unrelated /usr/bin/occ-ide.
set -e

# RPM passes an instance count; dpkg passes the package lifecycle action.
case "${1-}" in
  0 | remove | purge) ;;
  *) exit 0 ;;
esac

link="/usr/bin/occ-ide"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/OCC/*|/opt/occ-ide/*|/opt/occ/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0
