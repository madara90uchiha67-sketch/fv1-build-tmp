#!/usr/bin/env bash
# Verificación visual en el emulador: instala la compilación "preview" (datos de ejemplo, sin red), recorre
# cada pantalla con dos perfiles de pantalla (uno como el Infinix Hot 50i y otro más estrecho con letra grande),
# detecta elementos que se salen del ancho de la pantalla y deja capturas reducidas en el registro (base64).
set -u
PKG=inc.founder; OUT=evidence/pantallas; mkdir -p "$OUT"
APK=$(ls preview/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || { echo "FALLO: no se pudo instalar la compilación preview"; exit 1; }
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15

SCREENS="inicio:|negocio:negocio|chat:chat|chat-conversacion:chat?conversationId=demo|laboratorio:laboratorio|notas:notas|cuenta:cuenta|estrategia:estrategia|historial:historial|formulario:negocio/formulario?tipo=ventas|voz:preview-voz|voz-escuchando:preview-voz?phase=listening|voz-pensando:preview-voz?phase=thinking|voz-tu:preview-voz?phase=user_speaking|voz-error:preview-voz?phase=error|notas-pro:notas?composer=1|cuenta-perfil:cuenta?view=cuenta"
total_overflow=0

run_profile() { # nombre, tamaño, densidad, font_scale, imprimir_imagenes(1/0)
  local P="$1"
  adb shell wm size "$2"; adb shell wm density "$3"; adb shell settings put system font_scale "$4"
  sleep 3
  local W; W=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -dx -f1)
  local DP=$(( W * 160 / $3 ))
  echo "=== Perfil $P: ${2} @${3}dpi (~${DP} dp de ancho), letra x$4"
  IFS='|' read -ra LIST <<< "$SCREENS"
  for item in "${LIST[@]}"; do
    local name="${item%%:*}" route="${item#*:}"
    adb shell am start -a android.intent.action.VIEW -d "founder:///$route" -p "$PKG" >/dev/null 2>&1
    sleep 4
    adb exec-out screencap -p > "$OUT/$P-$name.png" 2>/dev/null
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/$P-$name.xml" >/dev/null 2>&1
    python3 - "$OUT/$P-$name.xml" "$W" "$P-$name" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
W = int(sys.argv[2]); bad = []
for m in re.finditer(r'<node [^>]*?>', xml):
    n = m.group(0)
    b = re.search(r'bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"', n)
    if not b: continue
    l, t, r, bt = map(int, b.groups())
    if (r > W + 2 or l < -2) and r - l > 0:
        label = re.search(r'(?:text|content-desc)="([^"]*)"', n)
        bad.append(f"[{l},{r}] {label.group(1)[:50] if label else ''}")
print(f"{'DESBORDE' if bad else 'ok      '} {sys.argv[3]}: {len(bad)} elemento(s) fuera del ancho {W}px")
for x in bad[:6]: print("   ", x)
sys.exit(1 if bad else 0)
PY
    [ $? -ne 0 ] && total_overflow=$((total_overflow+1))
    echo "   textos: $(grep -oE '(text|content-desc)="[^"]+"' "$OUT/$P-$name.xml" | head -8 | sed -E 's/^[a-z-]+="//; s/"$//' | tr '\n' '|')"
    if [ "$5" = "1" ]; then
      if command -v ffmpeg >/dev/null 2>&1; then
        ffmpeg -loglevel error -y -i "$OUT/$P-$name.png" -vf scale=330:-1 -q:v 8 "$OUT/$P-$name.jpg"
      elif command -v convert >/dev/null 2>&1; then
        convert "$OUT/$P-$name.png" -resize 330x -quality 55 "$OUT/$P-$name.jpg"
      else
        cp "$OUT/$P-$name.png" "$OUT/$P-$name.jpg"
      fi
      echo "@@IMG $P-$name $(stat -c %s "$OUT/$P-$name.jpg")"; base64 -w0 "$OUT/$P-$name.jpg"; echo; echo "@@END"
    fi
  done
}

run_profile infinix 720x1600 300 1.0 1
run_profile estrecho 720x1600 360 1.3 1
adb shell wm size reset; adb shell wm density reset; adb shell settings put system font_scale 1.0
adb shell dumpsys activity activities | grep -E "topResumedActivity" | head -1
adb logcat -d | grep -E "FATAL EXCEPTION" | head -3
echo "RESULTADO: pantallas con desborde = $total_overflow"
exit 0
