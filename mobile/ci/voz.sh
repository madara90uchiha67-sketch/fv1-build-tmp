#!/usr/bin/env bash
# Prueba de la llamada de voz en EMULADOR contra un servidor que imita a OpenAI Realtime (no es OpenAI ni un
# teléfono físico): la app abre la llamada real (permiso de micrófono, WebRTC, canal de datos, audio en los dos
# sentidos, altavoz e interrupción) y se mide en ambos extremos.
set -u
PKG=inc.founder; OUT=evidence/voz; mkdir -p "$OUT"
APK=$(ls preview/*.apk | head -1)
adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || { echo "FALLO: no se pudo instalar"; exit 1; }
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO && echo "permiso de micrófono concedido"
python3 -u mobile/ci/voice_fake_server.py "$OUT/servidor.json" > "$OUT/servidor.log" 2>&1 &
SRV=$!
sleep 4
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15
adb shell am start -a android.intent.action.VIEW -d "founder:///preview-llamada" -p "$PKG" >/dev/null 2>&1
sleep 40
adb logcat -d -s ReactNativeJS:V | grep "\[voz\]" > "$OUT/app.log"
adb shell dumpsys audio 2>/dev/null | grep -iE "mode|communication|speakerphone" | head -12 > "$OUT/audio-sistema.txt"
curl -s localhost:8787/result > "$OUT/resultado.json"
adb exec-out screencap -p > "$OUT/pantalla.png" 2>/dev/null
kill $SRV 2>/dev/null
echo "--- registro de la app ([voz]) ---"; sed 's/^.*\[voz\]/[voz]/' "$OUT/app.log" | awk '!seen[$0]++' | head -60
echo "--- servidor de prueba ---"; cat "$OUT/resultado.json"; echo; echo "--- registro del servidor ---"; tail -15 "$OUT/servidor.log"
echo "--- audio del sistema ---"; cat "$OUT/audio-sistema.txt"
fallo=0
chk() { if eval "$2"; then echo "OK   $1"; else echo "FALLO $1"; fallo=1; fi; }
chk "permiso de micrófono y micrófono abierto" "grep -q 'micrófono abierto' $OUT/app.log"
chk "la app conectó por WebRTC" "grep -q 'conexión=connected' $OUT/app.log"
chk "canal de datos abierto en la app" "grep -q 'canal de datos abierto' $OUT/app.log"
chk "altavoz activado por el módulo nativo" "grep -q 'altavoz activado: true' $OUT/app.log"
chk "el servidor recibió audio del teléfono (micrófono)" "python3 -c \"import json;d=json.load(open('$OUT/resultado.json'));exit(0 if d['tramas_audio_del_telefono']>100 else 1)\""
chk "la app recibió el audio de Founder" "grep -E 'audio: enviado=[0-9]+B recibido=[1-9][0-9]*B' $OUT/app.log | grep -q ."
chk "la app configuró la sesión (session.update)" "python3 -c \"import json;d=json.load(open('$OUT/resultado.json'));exit(0 if d['session_update']>=1 else 1)\""
chk "Founder saluda primero (la app pidió response.create)" "python3 -c \"import json;d=json.load(open('$OUT/resultado.json'));exit(0 if 'response.create' in d['tipos_recibidos'] else 1)\""
chk "la interrupción cortó a Founder (cancel + clear)" "python3 -c \"import json;d=json.load(open('$OUT/resultado.json'));exit(0 if d['interrupcion_confirmada'] else 1)\""
chk "conversación continua: segunda respuesta recibida" "grep -c 'evento output_audio_buffer.started' $OUT/app.log | awk '{exit !(\$1>=2)}'"
echo "@@IMG voz $(stat -c %s $OUT/pantalla.png)"; (command -v ffmpeg >/dev/null && ffmpeg -loglevel error -y -i "$OUT/pantalla.png" -vf scale=330:-1 -q:v 8 "$OUT/pantalla.jpg" && base64 -w0 "$OUT/pantalla.jpg" || true); echo; echo "@@END"
[ $fallo = 0 ] && echo "RESULTADO VOZ: OK (emulador + servidor de prueba)" || echo "RESULTADO VOZ: FALLO"
exit $fallo
