#!/usr/bin/env bash
# Inicia o servidor de voz em http://127.0.0.1:5184.
set -euo pipefail
cd "$(dirname "$0")"
[ -x .venv/bin/python ] && [ -f modelos/voices-v1.0.bin ] || ./instalar.sh
exec .venv/bin/python servidor.py
