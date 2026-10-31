#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3.11 -m venv .venv
  .venv/bin/pip install -e .
fi
exec .venv/bin/python -m uvicorn web.api:app --host 127.0.0.1 --port 8765
