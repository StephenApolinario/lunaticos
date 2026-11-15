#!/usr/bin/env python3
"""Servidor do protótipo: arquivos estáticos sem cache e a ponte da IA de bordo com a nuvem.

O `python3 -m http.server` não manda cabeçalho de cache, e o navegador acaba servindo
versões antigas dos módulos depois de uma edição. Este manda `Cache-Control: no-store`.

Com `OPENROUTER_API_KEY` no ambiente ou no arquivo `.env` da raiz do repositório, a IA de bordo
roda na nuvem: a página manda a conversa para `/ia/chat` e este servidor repassa ao OpenRouter.
A chave nunca vai para a página. Sem chave, a página usa o Ollama deste computador.

Uso:  python3 prototipo/tools/servir.py [porta]      (porta padrão: 5183, ou a variável PORT)

Publicado (ver o Dockerfile na raiz): `HOST=0.0.0.0` faz o servidor atender fora da própria máquina
e `SITE_ORIGINS` lista os endereços públicos da página, separados por vírgula
(ex.: `https://mapa.exemplo.org`). Só pedidos vindos desses endereços chegam à IA.
"""
from __future__ import annotations  # o python3 do macOS ainda é o 3.9

import functools
import http.server
import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_PORT = 5183
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ENV_FILE = os.path.join(ROOT, "..", ".env")  # fora da pasta servida

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-6-luna"
DEFAULT_REASONING = "low"
# O raciocínio do modelo conta nesse teto; a resposta em si tem até três frases.
MAX_ANSWER_TOKENS = 2000
MAX_BODY_BYTES = 400_000
MAX_MESSAGES = 60
MAX_TOOLS = 40
UPSTREAM_TIMEOUT_S = 60
# Publicado, qualquer pessoa com o endereço gasta o crédito da chave. Estes limites seguram o
# abuso: por visitante numa janela curta e no total por dia. O teto em dinheiro fica na própria chave.
RATE_WINDOW_S = 300
MAX_CALLS_PER_IP_IN_WINDOW = 60
MAX_CALLS_PER_DAY = 1500
DAY_S = 86400
SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
)


def read_env_file(path: str) -> dict[str, str]:
    """Lê linhas CHAVE=valor. Arquivo ausente não é erro: a IA só fica no modo local."""
    try:
        with open(path, encoding="utf-8") as file:
            pairs = (line.split("=", 1) for line in file if "=" in line and not line.lstrip().startswith("#"))
            return {key.strip(): value.strip().strip("\"'") for key, value in pairs}
    except FileNotFoundError:
        return {}


def setting(name: str, file_values: dict[str, str], default: str = "") -> str:
    return os.environ.get(name) or file_values.get(name) or default


class CallLimiter:
    """Conta as chamadas à IA por visitante (janela curta) e no total (por dia), na memória."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.by_ip: dict[str, list[float]] = {}
        self.day_start = 0.0
        self.day_calls = 0

    def allow(self, ip: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self.lock:
            if now - self.day_start >= DAY_S:
                self.day_start, self.day_calls = now, 0
                self.by_ip.clear()  # aproveita a virada do dia para não guardar visitante antigo
            recent = [at for at in self.by_ip.get(ip, []) if now - at < RATE_WINDOW_S]
            if len(recent) >= MAX_CALLS_PER_IP_IN_WINDOW or self.day_calls >= MAX_CALLS_PER_DAY:
                self.by_ip[ip] = recent
                return False
            self.by_ip[ip] = [*recent, now]
            self.day_calls += 1
            return True


class Handler(http.server.SimpleHTTPRequestHandler):
    api_key = ""
    model = DEFAULT_MODEL
    reasoning = DEFAULT_REASONING
    allowed_origins: frozenset[str] = frozenset()
    allowed_hosts: frozenset[str] = frozenset()
    limiter = CallLimiter()
    # Neste computador nada fica em cache, para uma edição aparecer na hora. Publicado, o navegador
    # guarda os arquivos e só confere se mudaram (os 10 MB de relevo e imagem não baixam de novo).
    cache_control = "no-store"

    def end_headers(self) -> None:
        self.send_header("Cache-Control", self.cache_control)
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)
        super().end_headers()

    def list_directory(self, path: str) -> None:
        """Pasta sem index.html não vira listagem de arquivos."""
        self.send_error(404, "não encontrado")
        return None

    def client_ip(self) -> str:
        """Atrás do proxy, o visitante vem no último endereço de X-Forwarded-For (posto pelo proxy)."""
        forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
        return forwarded or self.client_address[0]

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/ia/saude":
            return self.send_json(200, {"nuvem": bool(self.api_key), "modelo": self.model if self.api_key else None})
        super().do_GET()

    def request_allowed(self) -> bool:
        """Só a página deste servidor pode gastar o crédito da chave.

        Sem isto, qualquer site aberto no navegador poderia mandar perguntas para cá. O tipo
        `application/json` obriga o navegador a pedir permissão antes (e este servidor não dá).
        """
        origin = self.headers.get("Origin")
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return (
            self.headers.get("Host") in self.allowed_hosts
            and (origin is None or origin in self.allowed_origins)
            and content_type == "application/json"
        )

    def do_POST(self) -> None:
        if self.path != "/ia/chat":
            return self.send_json(404, {"error": {"message": "não encontrado"}})
        if not self.request_allowed():
            return self.send_json(403, {"error": {"message": "pedido recusado: origem, host ou tipo de conteúdo não permitidos"}})
        if not self.api_key:
            return self.send_json(503, {"error": {"message": "sem chave do OpenRouter neste servidor"}})
        if not self.limiter.allow(self.client_ip()):
            return self.send_json(429, {"error": {"message": "muitas perguntas em pouco tempo; espere um pouco"}})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY_BYTES:
                return self.send_json(413, {"error": {"message": "corpo vazio ou grande demais"}})
            data = json.loads(self.rfile.read(size))
            messages, tools = data["messages"], data.get("tools", [])
            if not isinstance(messages, list) or not isinstance(tools, list) or not 0 < len(messages) <= MAX_MESSAGES or len(tools) > MAX_TOOLS:
                raise ValueError("messages ou tools fora do formato")
        except (ValueError, KeyError, TypeError):
            return self.send_json(400, {"error": {"message": "JSON esperado: { messages, tools? }"}})
        # Modelo e limites são decididos aqui, não pela página.
        payload = {"model": self.model, "messages": messages, "max_tokens": MAX_ANSWER_TOKENS, "reasoning": {"effort": self.reasoning}}
        if tools:
            payload["tools"] = tools
        status, body = self.forward(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def forward(self, payload: dict) -> tuple[int, bytes]:
        request = urllib.request.Request(
            OPENROUTER_URL,
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_S) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:  # o OpenRouter respondeu com erro: repassa como veio
            return error.code, error.read()
        except (urllib.error.URLError, TimeoutError) as error:
            reason = getattr(error, "reason", error)
            return 502, json.dumps({"error": {"message": f"sem resposta do OpenRouter: {reason}"}}, ensure_ascii=False).encode()


def site_origins(port: int, extra: str) -> frozenset[str]:
    """Endereços de onde a página pode chamar a IA: a própria máquina e os de `SITE_ORIGINS`."""
    public = (origin.strip().rstrip("/") for origin in extra.split(","))
    return frozenset({f"http://localhost:{port}", f"http://127.0.0.1:{port}", *(origin for origin in public if origin)})


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", DEFAULT_PORT))
    file_values = read_env_file(ENV_FILE)
    Handler.api_key = setting("OPENROUTER_API_KEY", file_values)
    Handler.model = setting("OPENROUTER_MODEL", file_values, DEFAULT_MODEL)
    Handler.reasoning = setting("OPENROUTER_REASONING", file_values, DEFAULT_REASONING)
    public_origins = setting("SITE_ORIGINS", file_values)
    Handler.allowed_origins = site_origins(port, public_origins)
    Handler.cache_control = "no-cache" if public_origins else "no-store"
    Handler.allowed_hosts = frozenset(urllib.parse.urlsplit(origin).netloc for origin in Handler.allowed_origins)
    handler = functools.partial(Handler, directory=ROOT)
    # Sem HOST, só atende a própria máquina. Num contêiner, HOST=0.0.0.0.
    host = setting("HOST", file_values, "127.0.0.1")
    server = http.server.ThreadingHTTPServer((host, port), handler)
    # `docker stop` manda SIGTERM: sai na hora em vez de esperar ser morto.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    where = f"na nuvem ({Handler.model}, pelo OpenRouter)" if Handler.api_key else "local (Ollama); sem chave do OpenRouter"
    print(f"Protótipo em http://localhost:{port} · IA de bordo {where}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
