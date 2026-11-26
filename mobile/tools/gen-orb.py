#!/usr/bin/env python3
"""Genera las texturas de la esfera de voz de Founder (diseño propio, procedural). Requiere numpy y Pillow.
   orb-base.png  : esfera metálica (parte superior oscura, inferior plateada, reflejos fríos y cálidos)
   orb-band.png  : franja luminosa ondulada (azul, blanco, naranja); se repite en horizontal (2 periodos)
   orb-gloss.png : volumen (borde oscuro) y brillo especular que va por encima
"""
import numpy as np
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "orb")
S = 512

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def save(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), optimize=True)

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
cx = cy = (S - 1) / 2
nx, ny = (xx - cx) / (S / 2), (yy - cy) / (S / 2)   # -1..1
r = np.sqrt(nx ** 2 + ny ** 2)
inside = np.clip((1 - r) * (S / 2) + 0.5, 0, 1)      # borde con antialias

# ── base metálica ─────────────────────────────────────────────────────────────────
z = np.sqrt(np.clip(1 - r ** 2, 0, 1))
# horizonte curvo: la mitad de arriba es oscura y la de abajo plateada, con una transición nítida tipo cromo
horizon = 0.06 + 0.10 * nx ** 2 - 0.04 * nx
t = smooth(horizon - 0.07, horizon + 0.07, ny)
top = np.stack([0.035 + 0.05 * (1 - smooth(-1, 0.2, ny)), 0.045 + 0.055 * (1 - smooth(-1, 0.2, ny)), 0.07 + 0.08 * (1 - smooth(-1, 0.2, ny))], -1)
bot_l = 0.62 + 0.33 * smooth(0.0, 0.95, ny)          # plata: más clara cuanto más abajo
bot = np.stack([bot_l * 0.97, bot_l * 0.99, bot_l * 1.0], -1)
col = top * (1 - t[..., None]) + bot * t[..., None]
# luz cálida reflejada abajo-derecha y fría arriba-izquierda
warm = np.exp(-(((nx - 0.45) ** 2 + (ny - 0.78) ** 2) / 0.07))
cool = np.exp(-(((nx + 0.4) ** 2 + (ny + 0.55) ** 2) / 0.10))
col += warm[..., None] * np.array([0.35, 0.16, 0.02]) * 0.9
col += cool[..., None] * np.array([0.05, 0.10, 0.22]) * 0.8
# borde con efecto fresnel: se oscurece hacia el contorno arriba y se aclara abajo
fres = smooth(0.72, 1.0, r)
col = col * (1 - 0.45 * fres[..., None] * (1 - t[..., None])) + fres[..., None] * t[..., None] * 0.05
base = np.dstack([np.clip(col, 0, 1), inside])
save(base, "orb-base.png")

# ── franja luminosa ondulada (2 periodos horizontales, bucle perfecto) ──────────────────
W, H = 1024, 512
bx, by = np.mgrid[0:H, 0:W].astype(np.float32)
u = bx * 0 + by  # no usado
X = np.tile(np.arange(W, dtype=np.float32), (H, 1)) / W * 2 * np.pi * 2   # 2 periodos
Y = np.tile(np.arange(H, dtype=np.float32)[:, None], (1, W))
centre = H * 0.5 + 62 * np.sin(X + 0.4) + 26 * np.sin(2 * X + 1.9) + 10 * np.sin(3 * X + 0.3)
d = (Y - centre)
core = np.exp(-(d / 7.0) ** 2)
glow = np.exp(-(d / 26.0) ** 2)
halo = np.exp(-(d / 70.0) ** 2)
# segunda línea fina, desfasada
centre2 = centre + 22 + 9 * np.sin(2 * X + 0.7)
line2 = np.exp(-((Y - centre2) / 3.2) ** 2)
# color a lo largo de la franja: azul → blanco → naranja → blanco → azul (periódico)
ph = (np.arange(W, dtype=np.float32) / W * 2 * np.pi * 2)[None, :] + 0.0 * Y
blue = np.array([0.20, 0.50, 1.00]); orange = np.array([1.00, 0.55, 0.15]); white = np.array([1.0, 1.0, 1.0])
wb = (0.5 + 0.5 * np.sin(ph))[..., None]           # 0..1 azul↔naranja
tint = blue * (1 - wb) + orange * wb
whiteness = (0.55 + 0.45 * np.cos(ph * 2 + 0.8))[..., None]
edge_col = tint * (1 - 0.35 * whiteness) + white * 0.35 * whiteness
rgb = edge_col * (glow[..., None] * 0.9 + halo[..., None] * 0.35) + white * core[..., None] * 1.0 + tint * line2[..., None] * 0.9
alpha = np.clip(core * 1.0 + glow * 0.75 + halo * 0.28 + line2 * 0.55, 0, 1)
# des-premultiplicar para el PNG
col2 = np.where(alpha[..., None] > 1e-4, rgb / np.maximum(alpha[..., None], 1e-4), 0)
save(np.dstack([np.clip(col2, 0, 1), alpha]), "orb-band.png")

# ── volumen y brillo ───────────────────────────────────────────────────────────────
dark_edge = smooth(0.55, 1.0, r) * 0.55
spec = np.exp(-(((nx + 0.38) ** 2) / 0.05 + ((ny + 0.50) ** 2) / 0.012)) * 0.55
spec2 = np.exp(-(((nx - 0.05) ** 2) / 0.9 + ((ny - 0.93) ** 2) / 0.0035)) * 0.35
rim = smooth(0.93, 0.995, r) * smooth(-0.1, 0.9, ny) * 0.55 + smooth(0.955, 0.995, r) * 0.20   # filo de luz (más fuerte abajo)
a_dark = dark_edge * inside
white_a = np.clip(spec + spec2 + rim, 0, 1) * inside
alpha_g = np.clip(a_dark + white_a * (1 - a_dark), 0, 1)
col_g = np.where(alpha_g > 1e-4, (white_a * 1.0) / np.maximum(white_a + a_dark, 1e-4), 0)
g = np.dstack([np.repeat(col_g[..., None], 3, -1), alpha_g])
save(g, "orb-gloss.png")
print("ok")
