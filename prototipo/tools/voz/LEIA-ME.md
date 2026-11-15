# Voz local do assistente

Servidor que dá ao assistente do visor uma voz neural em português do Brasil, sem sair da máquina.

- **Modelo:** Kokoro-82M v1.0, em ONNX (325 MB), pelo pacote `kokoro-onnx`. Vozes pt-BR: `pf_dora` (padrão), `pm_alex`, `pm_santa`.
- **Licença:** Apache 2.0 (modelo e pacote). O fonema vem do espeak-ng (GPL-3.0), instalado pelo pacote `espeakng-loader`.
- **Fontes:** [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), [thewh1teagle/kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (arquivos `kokoro-v1.0.onnx` e `voices-v1.0.bin` da release `model-files-v1.0`).

## Uso

```bash
prototipo/tools/voz/instalar.sh     # uma vez (venv + pacotes + modelo)
prototipo/tools/voz/servir-voz.sh   # sobe em http://127.0.0.1:5184
```

- `GET /saude` devolve `{ ok, modelo, vozes, voz }`.
- `POST /falar` com `{ texto, voz?, velocidade? }` devolve WAV. Texto até 600 caracteres.

Só escuta em 127.0.0.1 e só aceita CORS de `localhost:5183` e `127.0.0.1:5183`. Sem o servidor, o visor volta para a voz do navegador.
`.venv/` e `modelos/` não vão para o git.
