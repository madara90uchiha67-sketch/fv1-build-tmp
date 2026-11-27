#!/usr/bin/env bash
# Prueba de la llamada de voz en EMULADOR contra OpenAI Realtime REAL (clave en el secreto OPENAI_API_KEY de GitHub).
# Verifica: sesión efímera real, conexión WebRTC con OpenAI, saludo hablado de Founder, conversación continua (pregunta
# enviada por texto), interrupción mientras Founder habla y segunda respuesta tras interrumpir. NO verifica que OpenAI
# entienda voz humana por el micrófono (el emulador no tiene micrófono real) ni el altavoz de un teléfono físico.
set -u
PKG=inc.founder; OUT=evidence/voz-real; mkdir -p "$OUT"
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "SIN CLAVE: el secreto OPENAI_API_KEY no está configurado en el repositorio. La prueba con OpenAI real NO se ejecutó."
  echo "RESULTADO VOZ REAL: NO PROBADO"
  exit 3
fi
APK=$(ls preview/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || { echo "FALLO: no se pudo instalar"; exit 1; }
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO && echo "permiso de micrófono concedido"
python3 -u mobile/ci/voice_real_server.py > "$OUT/servidor.log" 2>&1 &
SRV=$!
sleep 3
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15
adb shell am start -a android.intent.action.VIEW -d "founder:///preview-llamada" -p "$PKG" >/dev/null 2>&1
sleep 60
adb logcat -d -s ReactNativeJS:V | grep "\[voz\]" > "$OUT/app.log"
curl -s localhost:8787/ > "$OUT/sesion.json"
adb exec-out screencap -p > "$OUT/pantalla.png" 2>/dev/null
kill $SRV 2>/dev/null
echo "--- registro de la app ---"; sed 's/^.*\[voz\]/[voz]/' "$OUT/app.log" | awk '!seen[$0]++' | head -90
echo "--- sesión con OpenAI ---"; cat "$OUT/sesion.json"; echo
fallo=0
chk() { if eval "$2"; then echo "OK   $1"; else echo "FALLO $1"; fallo=1; fi; }
chk "OpenAI entregó una sesión efímera real" "python3 -c \"import json;d=json.load(open('$OUT/sesion.json'));exit(0 if d['sesiones_ok']>=1 else 1)\""
chk "la app conectó por WebRTC con OpenAI" "grep -q 'conexión=connected' $OUT/app.log"
chk "canal de datos abierto con OpenAI" "grep -q 'canal de datos abierto' $OUT/app.log"
chk "altavoz activado por el módulo nativo" "grep -q 'altavoz activado: true' $OUT/app.log"
chk "el micrófono envía audio a OpenAI" "grep -E 'audio: enviado=[1-9][0-9]*B' $OUT/app.log | grep -q ."
chk "la app recibe audio de Founder desde OpenAI" "grep -E 'audio: enviado=[0-9]+B recibido=[1-9][0-9]*B' $OUT/app.log | grep -q ."
chk "Founder saluda hablando (audio #1)" "grep -q 'REAL: audio de Founder #1 sonando' $OUT/app.log"
chk "el saludo termina" "grep -q 'REAL: saludo completo' $OUT/app.log"
chk "conversación continua: respuesta hablada a la pregunta (audio #2)" "grep -q 'REAL: audio de Founder #2 sonando' $OUT/app.log"
chk "se interrumpe a Founder mientras habla y se detiene" "grep -q 'REAL: interrumpiendo' $OUT/app.log && grep -q 'REAL: Founder se detuvo' $OUT/app.log"
chk "segunda respuesta de audio tras la interrupción" "grep -q 'REAL: segunda respuesta de audio' $OUT/app.log"
chk "la segunda respuesta termina completa" "grep -q 'GUION OK' $OUT/app.log"
chk "sin errores del servicio de OpenAI" "! grep -E 'evento error' $OUT/app.log | grep -vq 'cancel'"
echo "@@IMG voz-real $(stat -c %s $OUT/pantalla.png)"; (command -v ffmpeg >/dev/null && ffmpeg -loglevel error -y -i "$OUT/pantalla.png" -vf scale=330:-1 -q:v 8 "$OUT/pantalla.jpg" && base64 -w0 "$OUT/pantalla.jpg" || true); echo; echo "@@END"
[ $fallo = 0 ] && echo "RESULTADO VOZ REAL: OK (emulador + OpenAI real)" || echo "RESULTADO VOZ REAL: FALLO"
exit $fallo
