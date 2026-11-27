#!/usr/bin/env bash
# Prueba en EMULADOR (compilación preview, cuenta de demostración Pro): las recomendaciones pendientes aparecen al entrar
# a la app, sobreviven al cierre y reapertura, «Ignorar» las saca de pendientes y «Chat» abre una conversación con el
# contexto de la nota. No es una prueba en teléfono físico.
set -u
PKG=inc.founder; OUT=evidence/recs; mkdir -p "$OUT"
APK=$(ls preview/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || { echo "FALLO: no se pudo instalar"; exit 1; }
adb shell cmd statusbar collapse >/dev/null 2>&1; adb shell input keyevent KEYCODE_HOME; adb shell wm size 720x1600; adb shell wm density 300; sleep 2
fallo=0
chk() { if eval "$2"; then echo "OK   $1"; else echo "FALLO $1"; fallo=1; fi; }
open() { adb shell am start -a android.intent.action.VIEW -d "founder:///$1" -p "$PKG" >/dev/null 2>&1; sleep 4; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1; }
shot() { # nombre
  adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null
  if command -v ffmpeg >/dev/null 2>&1; then ffmpeg -loglevel error -y -i "$OUT/$1.png" -vf scale=330:-1 -q:v 8 "$OUT/$1.jpg"; else cp "$OUT/$1.png" "$OUT/$1.jpg"; fi
  echo "@@IMG $1 $(stat -c %s "$OUT/$1.jpg")"; base64 -w0 "$OUT/$1.jpg"; echo; echo "@@END"
}
tap_label() { # prefijo de content-desc
  python3 - "$OUT/ui.xml" "$1" <<'PY' > "$OUT/tap.txt"
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
for m in re.finditer(r'<node [^>]*?>', xml):
    n = m.group(0)
    d = re.search(r'content-desc="([^"]*)"', n)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if d and b and d.group(1).startswith(sys.argv[2]):
        l, t, r, bt = map(int, b.groups()); print((l + r) // 2, (t + bt) // 2); break
PY
  read -r X Y < "$OUT/tap.txt"; [ -n "${X:-}" ] && adb shell input tap "$X" "$Y"
}
nodos() { grep -oE '<node [^>]*content-desc="(Negro|Blanco)\.[^>]*>' "$OUT/ui.xml" | cut -c1-400; }
selected() { # prefijo → true/false según el atributo selected de uiautomator
  python3 - "$OUT/ui.xml" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
for m in re.finditer(r'<node [^>]*?>', xml):
    n = m.group(0)
    d = re.search(r'content-desc="([^"]*)"', n)
    if d and d.group(1).startswith(sys.argv[2]):
        print("true" if ('selected="true"' in n or 'checked="true"' in n) else "false"); break
else: print("nodo-no-encontrado")
PY
}

has() { grep -q "$1" "$OUT/ui.xml"; }
reopen() { adb shell am force-stop "$PKG"; sleep 2; adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 14; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 14
open preview-recomendaciones; dump ui
chk "se guardaron dos recomendaciones de prueba" "has recs-sembradas"
open ""; dump ui; shot recs-inicio
chk "Inicio muestra «Reunión con inversionistas» pendiente" "has 'Reunión con inversionistas'"
chk "Inicio muestra «Lanzamiento de campaña» pendiente" "has 'Lanzamiento de campaña'"
chk "Inicio muestra las recomendaciones de la nota" "has 'Preparar la presentación de la empresa'"
chk "cada una tiene botón Chat y botón Ignorar" "has 'Chat: Reunión' && has 'Ignorar: Lanzamiento'"

reopen; open ""; dump ui
chk "tras cerrar y reabrir la app siguen pendientes (2)" "has 'Reunión con inversionistas' && has 'Lanzamiento de campaña'"

tap_label "Ignorar: Lanzamiento"; sleep 2; dump ui; shot recs-tras-ignorar
chk "Ignorar quita esa recomendación de pendientes" "! has 'Lanzamiento de campaña'"
chk "la otra recomendación sigue pendiente" "has 'Reunión con inversionistas'"
reopen; open ""; dump ui
chk "la ignorada no vuelve tras cerrar y reabrir; la otra sigue" "! has 'Lanzamiento de campaña' && has 'Reunión con inversionistas'"

tap_label "Chat: Reunión"; sleep 6; dump ui; shot recs-chat
chk "Chat abre la conversación (pantalla de chat)" "has 'Mensaje para Founder'"
chk "el chat trae la nota y su descripción" "has 'Reunión con inversionistas' && has 'ronda semilla'"
chk "el chat trae la recomendación" "has 'Organizar las cifras del negocio'"
open ""; dump ui
chk "al elegir Chat deja de estar pendiente" "! has 'Reunión con inversionistas'"
reopen; open ""; dump ui
chk "sigue sin estar pendiente tras reabrir la app" "! has 'Reunión con inversionistas' && ! has 'Lanzamiento de campaña'"
adb shell wm size reset; adb shell wm density reset
adb logcat -d | grep -E "FATAL EXCEPTION" | head -3
[ $fallo = 0 ] && echo "RESULTADO RECOMENDACIONES: OK (emulador)" || echo "RESULTADO RECOMENDACIONES: FALLO"
exit $fallo
