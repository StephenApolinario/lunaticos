#!/usr/bin/env python3
"""Confere o que protege a IA quando o protótipo está publicado.   python3 prototipo/tools/check_servir.py"""
import servir

# Endereços aceitos: a própria máquina e os de SITE_ORIGINS, sem barra no fim nem item vazio.
origins = servir.site_origins(5183, " https://mapa.exemplo.org/ , ,https://outro.exemplo.org")
assert origins == {"http://localhost:5183", "http://127.0.0.1:5183", "https://mapa.exemplo.org", "https://outro.exemplo.org"}, origins
assert servir.site_origins(5183, "") == {"http://localhost:5183", "http://127.0.0.1:5183"}

# Limite por visitante: enche a janela, recusa, e volta a aceitar quando a janela passa.
limiter = servir.CallLimiter()
for _ in range(servir.MAX_CALLS_PER_IP_IN_WINDOW):
    assert limiter.allow("1.1.1.1", now=10.0)
assert not limiter.allow("1.1.1.1", now=11.0)
assert limiter.allow("2.2.2.2", now=11.0), "outro visitante não é afetado"
assert limiter.allow("1.1.1.1", now=10.0 + servir.RATE_WINDOW_S + 1)

# Limite do dia: vale para todos os visitantes somados e zera na virada do dia.
limiter = servir.CallLimiter()
for call in range(servir.MAX_CALLS_PER_DAY):
    assert limiter.allow(f"ip-{call}", now=5.0)
assert not limiter.allow("novo", now=6.0)
assert limiter.allow("novo", now=5.0 + servir.DAY_S + 1)

print("ok: endereços aceitos e limites de uso da IA")
