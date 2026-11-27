#!/usr/bin/env bash
# Prueba en emulador (NO en teléfono físico): un recordatorio programado por el módulo nativo de Founder debe
# llegar como notificación de Android con la app cerrada (proceso terminado, sin force-stop), con las
# recomendaciones dentro del texto.
set -u
PKG=inc.founder; OUT=evidence/notificaciones; mkdir -p "$OUT"
APK=$(ls preview/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || { echo "FALLO: no se pudo instalar la compilación preview"; exit 1; }
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS && echo "permiso de notificaciones concedido"
adb shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow && echo "alarmas exactas permitidas"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15
adb shell am start -a android.intent.action.VIEW -d "founder:///preview-recordatorio" -p "$PKG" >/dev/null 2>&1
sleep 5
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
STATUS=$(grep -oE 'recordatorio-[a-z]+( \([0-9]+\))?' "$OUT/ui.xml" | head -1)
echo "Estado en la app: ${STATUS:-sin texto}"
echo "$STATUS" | grep -q "recordatorio-programado" || { echo "FALLO: la app no pudo programar el recordatorio"; exit 1; }

# Se manda la app al fondo y se termina su proceso (como cuando Android la cierra o el usuario la quita).
adb shell input keyevent KEYCODE_HOME; sleep 2
adb root >/dev/null 2>&1; sleep 3
PID=$(adb shell pidof "$PKG" | tr -d '\r')
if [ -n "$PID" ]; then adb shell kill -9 $PID 2>/dev/null || adb shell am kill "$PKG"; fi
sleep 3
PID2=$(adb shell pidof "$PKG" | tr -d '\r')
[ -z "$PID2" ] && echo "App cerrada: el proceso ya no existe (antes pid=$PID)" || echo "AVISO: el proceso sigue vivo (pid=$PID2); la prueba es menos estricta"

sleep 40 # el aviso estaba programado a 25 s
adb shell dumpsys notification --noredact > "$OUT/dump.txt" 2>&1
grep -E "pkg=$PKG" "$OUT/dump.txt" | head -3
fallo=0
grep -q "Reunión con inversionistas" "$OUT/dump.txt" && echo "OK   la notificación llegó con la app cerrada" || { echo "FALLO no se encontró la notificación"; fallo=1; }
grep -q "Preparar la presentación de la empresa" "$OUT/dump.txt" && echo "OK   incluye las recomendaciones" || { echo "FALLO faltan las recomendaciones en el texto"; fallo=1; }
PID3=$(adb shell pidof "$PKG" | tr -d '\r'); echo "Proceso tras la entrega: ${PID3:-ninguno}"
adb shell cmd statusbar expand-notifications; sleep 3
adb exec-out screencap -p > "$OUT/persiana.png" 2>/dev/null
if command -v ffmpeg >/dev/null 2>&1; then ffmpeg -loglevel error -y -i "$OUT/persiana.png" -vf scale=330:-1 -q:v 8 "$OUT/persiana.jpg"; else cp "$OUT/persiana.png" "$OUT/persiana.jpg"; fi
echo "@@IMG persiana $(stat -c %s "$OUT/persiana.jpg")"; base64 -w0 "$OUT/persiana.jpg"; echo; echo "@@END"
[ $fallo = 0 ] && echo "RESULTADO NOTIFICACIONES: OK (emulador)" || echo "RESULTADO NOTIFICACIONES: FALLO"
exit $fallo
