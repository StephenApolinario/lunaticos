# Protótipo publicado: os arquivos da página e a ponte da IA de bordo (prototipo/tools/servir.py).
# Só a biblioteca padrão do Python; a voz neural e a escuta locais (tools/voz) ficam de fora.
#
#   docker build -t lunaticos .
#   docker run --rm -p 5183:5183 --env-file .env lunaticos
#
# Variáveis: OPENROUTER_API_KEY (sem ela a IA fica fora do ar) e SITE_ORIGINS, com o endereço
# público da página (ex.: https://mapa.exemplo.org), para a IA aceitar pedidos vindos dele.
FROM python:3.13-alpine

WORKDIR /app
COPY prototipo/index.html prototipo/styles.css ./prototipo/
COPY prototipo/src ./prototipo/src
COPY prototipo/data ./prototipo/data
COPY prototipo/visores ./prototipo/visores
COPY prototipo/assets ./prototipo/assets
COPY prototipo/tools/servir.py ./prototipo/tools/servir.py

ENV HOST=0.0.0.0 PORT=5183 PYTHONUNBUFFERED=1
EXPOSE 5183
USER nobody
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -qO /dev/null http://127.0.0.1:5183/ia/saude || exit 1
CMD ["python3", "prototipo/tools/servir.py"]
