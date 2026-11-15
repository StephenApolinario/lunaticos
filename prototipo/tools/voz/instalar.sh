#!/usr/bin/env bash
# Cria o venv, instala a fala (kokoro-onnx) e a escuta (faster-whisper) e baixa o modelo de fala.
# O modelo de escuta (Whisper small, cerca de 480 MB) é baixado pelo servidor na primeira vez. Pode rodar de novo sem refazer o que já existe.
set -euo pipefail
cd "$(dirname "$0")"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0

[ -x .venv/bin/python ] || "$UV" venv --python 3.12 .venv
"$UV" pip install --python .venv/bin/python kokoro-onnx faster-whisper
mkdir -p modelos
for arquivo in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "modelos/$arquivo" ]; then
    curl -fL --progress-bar -o "modelos/$arquivo.parcial" "$BASE/$arquivo"
    mv "modelos/$arquivo.parcial" "modelos/$arquivo"
  fi
done
echo "Pronto. Para iniciar: prototipo/tools/voz/servir-voz.sh"
