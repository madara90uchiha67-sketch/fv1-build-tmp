import { Alert, Linking } from "react-native";

export function openUrl(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("No se pudo abrir el enlace", "Revisa que tengas un navegador o una app de correo disponible.");
  });
}
