package expo.modules.founderreminders

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

/**
 * Recordatorios locales de Founder. Se programan con AlarmManager (sobreviven a que se cierre la app y,
 * con BootReceiver, a reiniciar el teléfono). Los datos de cada aviso se guardan en SharedPreferences.
 */
object ReminderStore {
  const val CHANNEL_ID = "founder-recordatorios"
  const val ACTION = "expo.modules.founderreminders.REMINDER"
  private const val PREFS = "founder_reminders"
  private const val KV = "founder_reminders_kv"

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun pending(ctx: Context, id: String, flags: Int): PendingIntent? {
    val intent = Intent(ctx, ReminderReceiver::class.java).setAction(ACTION).putExtra("id", id)
    return PendingIntent.getBroadcast(ctx, id.hashCode(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  fun canScheduleExact(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return am.canScheduleExactAlarms()
  }

  fun schedule(ctx: Context, id: String, triggerAt: Long, title: String, body: String): Boolean {
    val record = JSONObject().put("t", triggerAt).put("title", title).put("body", body)
    prefs(ctx).edit().putString("r:$id", record.toString()).apply()
    return arm(ctx, id, triggerAt)
  }

  private fun arm(ctx: Context, id: String, triggerAt: Long): Boolean {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(ctx, id, PendingIntent.FLAG_UPDATE_CURRENT) ?: return false
    return try {
      if (canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
      else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
      true
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
      true
    } catch (e: Exception) {
      false
    }
  }

  fun cancel(ctx: Context, id: String) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    pending(ctx, id, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
    prefs(ctx).edit().remove("r:$id").apply()
  }

  fun cancelAll(ctx: Context) {
    list(ctx).forEach { cancel(ctx, it) }
  }

  fun list(ctx: Context): List<String> =
    prefs(ctx).all.keys.filter { it.startsWith("r:") }.map { it.removePrefix("r:") }

  /** Vuelve a programar los avisos guardados (arranque del teléfono o actualización de la app). */
  fun rearm(ctx: Context) {
    val now = System.currentTimeMillis()
    for (id in list(ctx)) {
      val raw = prefs(ctx).getString("r:$id", null) ?: continue
      val record = try { JSONObject(raw) } catch (e: Exception) { continue }
      val t = record.optLong("t")
      when {
        t > now -> arm(ctx, id, t)
        now - t < 12L * 60 * 60 * 1000 -> show(ctx, id) // se perdió por el reinicio: se muestra ya
        else -> prefs(ctx).edit().remove("r:$id").apply()
      }
    }
  }

  fun show(ctx: Context, id: String) {
    val raw = prefs(ctx).getString("r:$id", null) ?: return
    val record = try { JSONObject(raw) } catch (e: Exception) { return }
    val title = record.optString("title", "Recordatorio de Founder")
    val body = record.optString("body", "")
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Recordatorios de notas", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Avisos de tus notas con recomendaciones de Founder"
        },
      )
    }
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val open = launch?.let { PendingIntent.getActivity(ctx, id.hashCode(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL_ID) else Notification.Builder(ctx)
    builder
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(title)
      .setContentText(body.lineSequence().firstOrNull { it.isNotBlank() } ?: body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_REMINDER)
    if (open != null) builder.setContentIntent(open)
    nm.notify(id.hashCode(), builder.build())
    prefs(ctx).edit().remove("r:$id").apply()
  }

  fun storeSet(ctx: Context, key: String, value: String) {
    ctx.getSharedPreferences(KV, Context.MODE_PRIVATE).edit().putString(key, value).apply()
  }

  fun storeGet(ctx: Context, key: String): String? =
    ctx.getSharedPreferences(KV, Context.MODE_PRIVATE).getString(key, null)

  fun storeClear(ctx: Context) {
    ctx.getSharedPreferences(KV, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
