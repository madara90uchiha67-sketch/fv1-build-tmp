#!/usr/bin/env bash
# Ejecuta en un solo emulador: humo del APK release, recorrido visual del APK preview y prueba de notificaciones.
cd "$(dirname "$0")/../.." || exit 1
bash mobile/ci/emulator-smoke.sh; r1=$?
bash mobile/ci/ui-screens.sh; r2=$?
bash mobile/ci/notificaciones.sh; r3=$?
bash mobile/ci/voz.sh; r4=$?
bash mobile/ci/tema.sh; r5=$?
bash mobile/ci/recs.sh; r6=$?
bash mobile/ci/voz-real.sh; r7=$?   # 3 = sin clave de OpenAI: no se probó (no cuenta como éxito de la voz real)
echo "== RESUMEN emulador: humo=$r1 pantallas=$r2 notificaciones=$r3 voz=$r4 tema=$r5 recomendaciones=$r6 voz-real=$r7"
[ $r1 = 0 ] && [ $r3 = 0 ]
