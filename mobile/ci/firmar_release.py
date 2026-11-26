#!/usr/bin/env python3
"""Hace que el build 'release' del proyecto generado por expo prebuild se firme con la clave de prueba.
La clave llega por variables de entorno (nunca queda escrita en el repositorio)."""
import re, sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

bloque = '''
        release {
            storeFile file(System.getenv("FOUNDER_KEYSTORE_FILE"))
            storePassword System.getenv("FOUNDER_KEYSTORE_PASSWORD")
            keyAlias System.getenv("FOUNDER_KEY_ALIAS")
            keyPassword System.getenv("FOUNDER_KEY_PASSWORD")
        }
'''
m = re.search(r"signingConfigs\s*\{", text)
if not m:
    sys.exit("No se encontró signingConfigs en build.gradle")
text = text[:m.end()] + bloque + text[m.end():]

# En buildTypes.release, sustituir la firma de depuración por la de release.
i = text.find("buildTypes")
j = text.find("release {", i)
if i < 0 or j < 0:
    sys.exit("No se encontró buildTypes.release")
k = text.find("signingConfig signingConfigs.debug", j)
if k < 0:
    sys.exit("No se encontró la firma debug en release")
text = text[:k] + "signingConfig signingConfigs.release" + text[k + len("signingConfig signingConfigs.debug"):]
path.write_text(text)
print("Firma de release configurada.")
