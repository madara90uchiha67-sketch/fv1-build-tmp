#!/usr/bin/env bash
# Prueba del tema blanco en EMULADOR (compilación preview): cambia el tema desde Configuración tocando la opción,
# comprueba que la app se reinicia sola, que el tema se aplica a las demás pantallas y que se conserva al cerrar y
# volver a abrir la app. Deja capturas (reducidas, en base64) de las pantallas en tema claro.
set -u
PKG=inc.founder; OUT=evidence/tema; mkdir -p "$OUT"
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
pid() { adb shell pidof "$PKG" | tr -d '\r'; }

adb logcat -c; adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 14
open cuenta; dump ui; cp "$OUT/ui.xml" "$OUT/oscuro.xml"; echo "nodos de tema:"; nodos
chk "arranca en tema Negro por defecto" "[ \"\$(selected 'Negro.')\" = true ]"
shot cuenta-oscuro
P1=$(pid); echo "pid antes: $P1"
tap_label "Blanco."
sleep 12
P2=$(pid); echo "pid después: $P2"
adb logcat -d | grep -iE "RestartActivity|Background activity|BAL_|START u0.*inc.founder|Force stopping|Process inc.founder.* has died" | tail -15 | cut -c1-220
chk "la app se reinició sola al elegir Blanco (proceso nuevo)" "[ -n \"$P2\" ] && [ \"$P1\" != \"$P2\" ]"
adb shell dumpsys activity activities | grep -E "topResumedActivity" | head -1
chk "tras reiniciar, Founder está en primer plano" "adb shell dumpsys activity activities | grep topResumedActivity | grep -q inc.founder"
open cuenta; dump ui
chk "Blanco aparece seleccionado" "[ \"\$(selected 'Blanco.')\" = true ]"
for s in inicio:  negocio:negocio chat:chat laboratorio:laboratorio notas:notas cuenta:cuenta estrategia:estrategia historial:historial notas-pro:notas?composer=1 voz-escuchando:preview-voz?phase=listening voz-pensando:preview-voz?phase=thinking voz-error:preview-voz?phase=error; do
  name="${s%%:*}"; route="${s#*:}"; open "$route"; shot "claro-$name"
done
# Persistencia: cerrar del todo la app y volver a abrirla
adb shell am force-stop "$PKG"; sleep 2
adb logcat -c; adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 14
open cuenta; dump ui
chk "el tema Blanco se conserva al cerrar y volver a abrir" "[ \"\$(selected 'Blanco.')\" = true ]"
# Volver a Negro
tap_label "Negro."; sleep 12
open cuenta; dump ui
chk "se puede volver a Negro" "[ \"\$(selected 'Negro.')\" = true ]"
shot cuenta-vuelta-oscuro
adb shell wm size reset; adb shell wm density reset
adb logcat -d | grep -E "FATAL EXCEPTION" | head -3
[ $fallo = 0 ] && echo "RESULTADO TEMA: OK (emulador)" || echo "RESULTADO TEMA: FALLO"
exit $fallo
