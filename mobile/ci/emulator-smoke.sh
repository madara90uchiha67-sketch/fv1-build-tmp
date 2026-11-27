#!/usr/bin/env bash
# Prueba de humo en emulador Android 14: instala el APK nativo, lo abre y comprueba que el primer plano
# es la actividad nativa de Founder (inc.founder), que NO se abrió Chrome y que no hubo cierres.
set -u
APK=$(ls apk/*.apk | head -1); PKG=inc.founder; OUT=evidence; mkdir -p "$OUT"
echo "== Android $(adb shell getprop ro.build.version.release) (SDK $(adb shell getprop ro.build.version.sdk))"
adb install -r "$APK" || { echo "FALLO: no se pudo instalar"; exit 1; }
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25
adb shell dumpsys activity activities > "$OUT/activities.txt" 2>&1
adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>&1
adb exec-out screencap -p > "$OUT/pantalla.png" 2>/dev/null || true
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true

TOP=$(grep -E "topResumedActivity" "$OUT/activities.txt" | head -1)
echo "Primer plano: $TOP"
grep -E -A14 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40
echo "== Textos visibles en la pantalla (ui.xml)"
grep -o 'text="[^"]\+"' "$OUT/ui.xml" 2>/dev/null | head -20
fallo=0
echo "$TOP" | grep -q "$PKG/.*MainActivity" && echo "OK   primer plano = actividad nativa de Founder" || { echo "FALLO primer plano no es MainActivity de Founder"; fallo=1; }
echo "$TOP" | grep -q "com.android.chrome" && { echo "FALLO se abrió Chrome"; fallo=1; } || echo "OK   Chrome no está en primer plano"
grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" && { echo "FALLO cierre inesperado (FATAL EXCEPTION)"; fallo=1; } || echo "OK   sin cierres inesperados"
[ $fallo = 0 ] && echo "RESULTADO: OK - Founder corre como app nativa" || echo "RESULTADO: FALLO"
exit $fallo
