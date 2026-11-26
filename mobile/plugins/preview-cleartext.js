// Solo para la compilación preview de CI (EXPO_PUBLIC_UI_PREVIEW=1): permite http hacia el servidor de prueba
// de voz del emulador. La compilación que se entrega no pasa por aquí y mantiene el tráfico en claro desactivado.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function previewCleartext(config) {
  if (process.env.EXPO_PUBLIC_UI_PREVIEW !== "1") return config;
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return cfg;
  });
};
