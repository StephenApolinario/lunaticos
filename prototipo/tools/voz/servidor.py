"""Servidor local de voz do assistente, só em 127.0.0.1:5184.

Fala com o Kokoro-82M (kokoro-onnx) e escuta com o Whisper (faster-whisper): o áudio do microfone
não sai deste computador.
"""
import io
import json
import threading
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import av
import numpy as np
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

PORTA = 5184
HOSTS = frozenset({f"127.0.0.1:{PORTA}", f"localhost:{PORTA}"})
MAX_TEXTO = 600
MAX_CORPO = 4096
CACHE_MAX = 64
VOZES = ("pf_dora", "pm_alex", "pm_santa")
VOZ_PADRAO = "pf_dora"
VELOCIDADE = (0.7, 1.5)
ORIGENS = {"http://localhost:5183", "http://127.0.0.1:5183"}
PASTA = Path(__file__).parent / "modelos"
# Escuta: modelo multilíngue "small" (cerca de 480 MB, baixado na primeira vez para modelos/whisper).
MODELO_ESCUTA = "small"
MAX_AUDIO = 3_000_000
# Palavras da missão, para o reconhecimento preferir "rover" a "hover", por exemplo.
VOCABULARIO = "Saída em Marte: oxigênio, habitat, rover Curiosity, jipe, traje, radiação, parada, protocolo, visor, abrigo, amostra."

kokoro = Kokoro(str(PASTA / "kokoro-v1.0.onnx"), str(PASTA / "voices-v1.0.bin"))
trava = threading.Lock()  # o onnxruntime fica com uma síntese por vez
cache = OrderedDict()
trava_escuta = threading.Lock()
escuta = None


def modelo_de_escuta() -> WhisperModel:
    """Carrega o Whisper na primeira vez (e baixa o modelo se ainda não estiver na pasta)."""
    global escuta
    with trava_escuta:
        if escuta is None:
            escuta = WhisperModel(MODELO_ESCUTA, device="cpu", compute_type="int8", download_root=str(PASTA / "whisper"))
        return escuta


def decodificar(audio: bytes) -> np.ndarray:
    """Áudio do navegador (webm, ogg ou wav) em amostras mono de 16 kHz, que é o que o Whisper lê."""
    conversor = av.AudioResampler(format="s16", layout="mono", rate=16000)
    partes = []
    with av.open(io.BytesIO(audio), mode="r") as arquivo:
        for quadro in arquivo.decode(audio=0):
            partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(quadro))
    partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(None))
    return np.concatenate(partes).astype(np.float32) / 32768.0


def reconhecer(audio: bytes) -> str:
    modelo = modelo_de_escuta()
    amostras = decodificar(audio)
    with trava_escuta:
        trechos, _ = modelo.transcribe(amostras, language="pt", beam_size=3, vad_filter=True, initial_prompt=VOCABULARIO)
        return " ".join(trecho.text.strip() for trecho in trechos).strip()


def sintetizar(texto, voz, velocidade):
    chave = (texto, voz, velocidade)
    with trava:
        if chave in cache:
            cache.move_to_end(chave)
            return cache[chave]
        amostras, taxa = kokoro.create(texto, voice=voz, speed=velocidade, lang="pt-br")
        pcm = (np.clip(amostras, -1, 1) * 32767).astype("<i2")
        saida = io.BytesIO()
        with wave.open(saida, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(taxa)
            wav.writeframes(pcm.tobytes())
        cache[chave] = saida.getvalue()
        if len(cache) > CACHE_MAX:
            cache.popitem(last=False)
        return cache[chave]


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origem = self.headers.get("Origin")
        if origem in ORIGENS:
            self.send_header("Access-Control-Allow-Origin", origem)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def responder(self, codigo, corpo, tipo="application/json"):
        if isinstance(corpo, (dict, list)):
            corpo = json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.cors()
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path != "/saude":
            return self.responder(404, {"erro": "não encontrado"})
        self.responder(200, {"ok": True, "modelo": "Kokoro-82M", "vozes": list(VOZES), "voz": VOZ_PADRAO, "ouvir": True})

    def pedido_permitido(self, audio: bool = False) -> bool:
        """Só a página do protótipo pode pedir fala: confere Host, Origin e o tipo do corpo.

        O CORS só impede outra página de ler a resposta; sem esta checagem, qualquer site aberto
        no navegador conseguiria mandar texto para sintetizar e ocupar a máquina.
        """
        origem = self.headers.get("Origin")
        tipo = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return (
            self.headers.get("Host") in HOSTS
            and (origem is None or origem in ORIGENS)
            and (tipo.startswith("audio/") if audio else tipo == "application/json")
        )

    def ouvir(self):
        if not self.pedido_permitido(audio=True):
            return self.responder(403, {"erro": "pedido recusado: origem, host ou tipo de conteúdo não permitidos"})
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            tamanho = 0
        if not 0 < tamanho <= MAX_AUDIO:
            return self.responder(413, {"erro": "áudio vazio ou grande demais"})
        try:
            self.responder(200, {"texto": reconhecer(self.rfile.read(tamanho))})
        except Exception as erro:  # noqa: BLE001 - o servidor não pode cair por um áudio ruim
            print("falha ao reconhecer:", erro)
            self.responder(500, {"erro": "falha ao reconhecer a fala"})

    def do_POST(self):
        if self.path == "/ouvir":
            return self.ouvir()
        if self.path != "/falar":
            return self.responder(404, {"erro": "não encontrado"})
        if not self.pedido_permitido():
            return self.responder(403, {"erro": "pedido recusado: origem, host ou tipo de conteúdo não permitidos"})
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
            if not 0 < tamanho <= MAX_CORPO:
                return self.responder(413, {"erro": "corpo inválido ou grande demais"})
            dados = json.loads(self.rfile.read(tamanho))
            texto = dados["texto"].strip()
            voz = dados.get("voz", VOZ_PADRAO)
            velocidade = float(dados.get("velocidade", 1.0))
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.responder(400, {"erro": "JSON esperado: { texto, voz?, velocidade? }"})
        if not texto or len(texto) > MAX_TEXTO:
            return self.responder(400, {"erro": f"texto vazio ou acima de {MAX_TEXTO} caracteres"})
        if voz not in VOZES:
            return self.responder(400, {"erro": "voz desconhecida", "vozes": list(VOZES)})
        if not VELOCIDADE[0] <= velocidade <= VELOCIDADE[1]:
            return self.responder(400, {"erro": f"velocidade entre {VELOCIDADE[0]} e {VELOCIDADE[1]}"})
        try:
            self.responder(200, sintetizar(texto, voz, round(velocidade, 2)), "audio/wav")
        except Exception as erro:  # noqa: BLE001 - o servidor não pode cair por uma frase
            print("falha ao sintetizar:", erro)
            self.responder(500, {"erro": "falha ao sintetizar"})

    def log_message(self, formato, *args):
        pass


if __name__ == "__main__":
    print(f"Voz local (fala: Kokoro-82M, escuta: Whisper {MODELO_ESCUTA}) em http://127.0.0.1:{PORTA}  (Ctrl+C para parar)")
    # Carrega a escuta em segundo plano, para a primeira frase ditada não esperar o modelo.
    threading.Thread(target=modelo_de_escuta, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORTA), Handler).serve_forever()
