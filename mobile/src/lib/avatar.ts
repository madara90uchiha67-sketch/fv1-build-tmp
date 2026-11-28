import { uiGet, uiSet } from "../../modules/founder-reminders";

// Foto de perfil: se guarda solo en este teléfono (reducida a 384 px), asociada a la cuenta. No se envía a ningún servidor.
const key = (userId: string) => `avatar:${userId}`;

export function loadAvatar(userId: string | undefined): string | null {
  if (!userId) return null;
  const v = uiGet(key(userId));
  return v && v.startsWith("data:image/") ? v : null;
}

export function saveAvatar(userId: string, dataUri: string | null): void {
  uiSet(key(userId), dataUri ?? "");
}

export type PickResult = { ok: true; uri: string } | { ok: false; reason: "cancelled" | "denied" | "failed" };

/** Abre la galería, deja recortar en cuadrado y devuelve la imagen reducida como data URI JPEG. */
export async function pickAvatar(): Promise<PickResult> {
  try {
    const Picker = await import("expo-image-picker");
    const res = await Picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true });
    if (res.canceled || !res.assets?.length) return { ok: false, reason: "cancelled" };
    const asset = res.assets[0];
    try {
      const M = await import("expo-image-manipulator");
      const ctx = M.ImageManipulator.manipulate(asset.uri);
      ctx.resize({ width: 384 });
      const img = await ctx.renderAsync();
      const out = await img.saveAsync({ format: M.SaveFormat.JPEG, compress: 0.8, base64: true });
      if (out.base64) return { ok: true, uri: `data:image/jpeg;base64,${out.base64}` };
    } catch { /* si no se pudo reducir, se usa la imagen recortada tal cual si no es enorme */ }
    if (asset.base64 && asset.base64.length < 700_000) return { ok: true, uri: `data:image/jpeg;base64,${asset.base64}` };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
