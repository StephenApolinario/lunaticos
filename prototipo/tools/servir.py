#!/usr/bin/env python3
"""Servidor estático do protótipo, sem cache.

O `python3 -m http.server` não manda cabeçalho de cache, e o navegador acaba servindo
versões antigas dos módulos depois de uma edição. Este manda `Cache-Control: no-store`.

Uso:  python3 prototipo/tools/servir.py [porta]      (porta padrão: 5183, ou a variável PORT)
"""
import functools
import http.server
import os
import sys

DEFAULT_PORT = 5183
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", DEFAULT_PORT))
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    # Só atende a própria máquina.
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Protótipo em http://localhost:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
