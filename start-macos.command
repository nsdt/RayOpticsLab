#!/bin/sh
# Run beside launch.py; spaces and non-ASCII folder names are supported.
LAUNCH_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1
LAUNCH_PYTHON=
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
        LAUNCH_PYTHON=$candidate
        break
    fi
done
if [ -z "$LAUNCH_PYTHON" ]; then
    printf '%s\n' 'Python 3.9 or later is required. Install Python, then run this file again.'
    if [ -t 0 ]; then printf 'Press Enter to close: '; read -r answer; fi
    exit 1
fi
"$LAUNCH_PYTHON" -X utf8 "$LAUNCH_DIR/launch.py" "$@"
LAUNCH_RESULT=$?
if [ "$LAUNCH_RESULT" -ne 0 ] && [ -t 0 ]; then
    printf 'Press Enter to close: '
    read -r answer
fi
exit "$LAUNCH_RESULT"
