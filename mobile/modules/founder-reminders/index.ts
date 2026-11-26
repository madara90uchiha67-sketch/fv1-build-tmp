import { requireOptionalNativeModule } from "expo-modules-core";

// Módulo nativo local (Android): recordatorios con AlarmManager + notificaciones del sistema.
// Funcionan con la app cerrada y se reprograman al reiniciar el teléfono.
type Native = {
  schedule(id: string, triggerAtMs: number, title: string, body: string): boolean;
  cancel(id: string): void;
  cancelAll(): void;
  list(): string[];
  canNotify(): boolean;
  canScheduleExact(): boolean;
  openExactAlarmSettings(): void;
  openNotificationSettings(): void;
  storeSet(key: string, value: string): void;
  storeGet(key: string): string | null;
  uiSet(key: string, value: string): boolean;
  uiGet(key: string): string | null;
  restartApp(): boolean;
};
const native = requireOptionalNativeModule<Native>("FounderReminders");

export const remindersAvailable = native !== null;
export function scheduleReminder(id: string, triggerAtMs: number, title: string, body: string): boolean {
  try { return native?.schedule(id, triggerAtMs, title, body) ?? false; } catch { return false; }
}
export function cancelReminder(id: string): void { try { native?.cancel(id); } catch { /* sin efecto */ } }
export function cancelAllReminders(): void { try { native?.cancelAll(); } catch { /* sin efecto */ } }
export function scheduledReminderIds(): string[] { try { return native?.list() ?? []; } catch { return []; } }
export function canNotify(): boolean { try { return native?.canNotify() ?? false; } catch { return false; } }
export function canScheduleExact(): boolean { try { return native?.canScheduleExact() ?? false; } catch { return false; } }
export function openExactAlarmSettings(): void { try { native?.openExactAlarmSettings(); } catch { /* sin efecto */ } }
export function openNotificationSettings(): void { try { native?.openNotificationSettings(); } catch { /* sin efecto */ } }
export function storeSet(key: string, value: string): void { try { native?.storeSet(key, value); } catch { /* sin efecto */ } }
export function storeGet(key: string): string | null { try { return native?.storeGet(key) ?? null; } catch { return null; } }
export function uiSet(key: string, value: string): boolean { try { return native?.uiSet(key, value) ?? false; } catch { return false; } }
export function uiGet(key: string): string | null { try { return native?.uiGet(key) ?? null; } catch { return null; } }
export function restartApp(): boolean { try { return native?.restartApp() ?? false; } catch { return false; } }
