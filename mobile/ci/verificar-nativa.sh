#!/usr/bin/env bash
# Verifica firma y SDK del APK y comprueba que es una app nativa (React Native), no una TWA ni un WebView.
set -u
APK=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
AAB=$(ls android/app/build/outputs/bundle/release/*.aab | head -1)
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
fallo=0
echo "== APK: $APK"; ls -l "$APK" "$AAB"
"$BT/apksigner" verify --print-certs "$APK" | tee certs.txt
"$BT/aapt2" dump badging "$APK" > badging.txt
grep -E "^package:|[sS]dkVersion|launchable-activity" badging.txt
echo "== AAB firmado (jarsigner)"; jarsigner -verify "$AAB" | head -2

echo "== Comprobaciones de que es NATIVA"
"$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" > manifest.txt
chk() { # descripción, comando que debe tener éxito
  if eval "$2"; then echo "OK   $1"; else echo "FALLO $1"; fallo=1; fi
}
chk "contiene la actividad nativa MainActivity" "grep -q 'inc.founder.MainActivity' manifest.txt"
chk "NO declara androidbrowserhelper / LauncherActivity de TWA" "! grep -qiE 'androidbrowserhelper|trusted.LauncherActivity|asset_statements|DEFAULT_URL' manifest.txt"
chk "NO declara WebViewFallbackActivity" "! grep -qi 'WebViewFallback' manifest.txt"
rm -rf apkx && mkdir apkx && (cd apkx && unzip -q "../$APK")
chk "incluye motor Hermes (libhermes) y React Native" "ls apkx/lib/arm64-v8a | grep -qE 'libhermes|libreactnative'"
chk "incluye el bundle JS embebido" "unzip -l $APK | grep -qE 'index.android.bundle|assets/.*\.bundle'"
chk "ningún dex referencia androidbrowserhelper" "! cat apkx/classes*.dex | grep -aq 'com/google/androidbrowserhelper'"
chk "ningún dex usa react-native-webview" "! cat apkx/classes*.dex | grep -aq 'com/reactnativecommunity/webview'"
# Secretos: ninguna clave de OpenAI (ni su nombre de variable de servidor) debe viajar dentro de la app.
BUNDLE=$(find apkx -name 'index.android.bundle' | head -1)
# Una clave real empieza por «sk-» tras un carácter que no sea de palabra (así no coincide con «task-…», «mask-…», «disk-…»).
KEYRE='(^|[^A-Za-z0-9_-])sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}'
echo '   (diagnóstico: palabras que terminan en «sk-», solo el prefijo, nunca el valor)'
grep -aoE '[A-Za-z0-9_]{0,10}sk-' $BUNDLE | sort | uniq -c | sort -rn | head -5 || true
chk "el bundle JS no contiene ninguna clave de OpenAI (sk-…)" "! grep -aqE '$KEYRE' $BUNDLE"
chk "el bundle JS no menciona OPENAI_API_KEY" "! grep -aq 'OPENAI_API_KEY' $BUNDLE"
chk "el APK completo no contiene ninguna clave de OpenAI (sk-…)" "! grep -raqE '$KEYRE' apkx"
chk "package.json no depende de react-native-webview" "! grep -q 'react-native-webview' package.json"

{
  echo '### Huella del certificado'; grep -i 'SHA-256' certs.txt
  echo '### Paquete y SDK'; grep -E "^package:|[sS]dkVersion" badging.txt
  echo "### Nativa: $([ $fallo = 0 ] && echo 'todas las comprobaciones OK' || echo 'HAY FALLOS')"
} >> "$GITHUB_STEP_SUMMARY"
exit $fallo
