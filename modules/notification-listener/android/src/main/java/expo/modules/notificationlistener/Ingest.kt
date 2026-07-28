package expo.modules.notificationlistener

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * 가로챈 알림을 서버로 보내는 부분.
 *
 * 알림은 앱이 종료된 상태에서도 도착하므로 JS를 깨우지 않고 여기서 전송까지 끝낸다.
 * 전송에 실패하면(비행기 모드, 지하 등) SharedPreferences 큐에 남겨 두고 다음 알림이 올 때나
 * 앱이 포그라운드로 돌아올 때(JS의 flush()) 다시 시도한다.
 */
object Ingest {
  private const val PREFS = "notification_listener"
  private const val KEY_ENDPOINT = "endpoint"
  private const val KEY_SECRET = "secret"
  private const val KEY_DEVICE_ID = "deviceId"
  private const val KEY_QUEUE = "queue"
  private const val KEY_LAST_POSTED_AT = "lastPostedAt"

  /** 큐가 무한정 커지지 않도록 상한을 두고, 넘치면 오래된 것부터 버린다. */
  private const val MAX_QUEUE = 200

  /** 서버의 events 배열 상한과 맞춘다. */
  private const val MAX_BATCH = 50

  private const val TAG = "NotificationIngest"

  // 알림 콜백은 메인 스레드에서 온다 — 네트워크는 반드시 별도 스레드에서.
  private val executor = Executors.newSingleThreadExecutor()

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setIngest(context: Context, endpoint: String, secret: String, deviceId: String) {
    prefs(context).edit()
      .putString(KEY_ENDPOINT, endpoint)
      .putString(KEY_SECRET, secret)
      .putString(KEY_DEVICE_ID, deviceId)
      .apply()
  }

  fun isConfigured(context: Context): Boolean {
    val p = prefs(context)
    return !p.getString(KEY_ENDPOINT, null).isNullOrBlank() &&
      !p.getString(KEY_SECRET, null).isNullOrBlank() &&
      !p.getString(KEY_DEVICE_ID, null).isNullOrBlank()
  }

  fun queueSize(context: Context): Int = readQueue(context).length()

  fun lastPostedAt(context: Context): Long = prefs(context).getLong(KEY_LAST_POSTED_AT, 0L)

  fun sha256(input: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
  }

  @Synchronized
  fun enqueue(context: Context, event: JSONObject) {
    val queue = readQueue(context)
    queue.put(event)

    // 오래된 것부터 버린다.
    val trimmed = if (queue.length() > MAX_QUEUE) {
      JSONArray().also { out ->
        for (i in (queue.length() - MAX_QUEUE) until queue.length()) out.put(queue.get(i))
      }
    } else {
      queue
    }

    prefs(context).edit()
      .putString(KEY_QUEUE, trimmed.toString())
      .putLong(KEY_LAST_POSTED_AT, System.currentTimeMillis())
      .apply()
  }

  /** 큐를 백그라운드에서 비운다. 결과를 기다리지 않는다(알림 콜백을 막지 않기 위해). */
  fun flushAsync(context: Context) {
    val app = context.applicationContext
    executor.execute { flushBlocking(app) }
  }

  /** 전송에 성공한 건수를 돌려준다. JS의 flush()가 결과를 보여주는 데 쓴다. */
  @Synchronized
  fun flushBlocking(context: Context): Int {
    if (!isConfigured(context)) return 0

    val p = prefs(context)
    val endpoint = p.getString(KEY_ENDPOINT, null) ?: return 0
    val secret = p.getString(KEY_SECRET, null) ?: return 0
    val deviceId = p.getString(KEY_DEVICE_ID, null) ?: return 0

    var sent = 0
    while (true) {
      val queue = readQueue(context)
      if (queue.length() == 0) break

      val batchSize = minOf(queue.length(), MAX_BATCH)
      val batch = JSONArray()
      for (i in 0 until batchSize) batch.put(queue.get(i))

      val body = JSONObject()
        .put("deviceId", deviceId)
        .put("events", batch)

      val outcome = post(endpoint, secret, body.toString())
      if (outcome == Outcome.RETRY_LATER) break

      // 성공이든 영구 실패(400/401 등)든 큐에서는 뺀다 — 남겨두면 영원히 재시도만 반복한다.
      val rest = JSONArray()
      for (i in batchSize until queue.length()) rest.put(queue.get(i))
      p.edit().putString(KEY_QUEUE, rest.toString()).apply()

      if (outcome == Outcome.OK) sent += batchSize
    }
    return sent
  }

  private enum class Outcome { OK, DROP, RETRY_LATER }

  private fun post(endpoint: String, secret: String, json: String): Outcome {
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 10_000
        readTimeout = 20_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("x-ingest-secret", secret)
      }
      OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(json) }

      when (val code = connection.responseCode) {
        in 200..299 -> Outcome.OK

        // 시간이 지나거나 서버 설정을 고치면 풀리는 것들은 큐에 남긴다.
        //  - 401/403: 시크릿 미설정·불일치 → Vercel 환경변수를 고치면 복구된다.
        //    여기서 버리면 설정이 틀린 동안 도착한 알림이 전부 조용히 사라진다.
        //  - 408/429/5xx: 타임아웃·레이트리밋·서버 오류
        401, 403, 408, 429, in 500..599 -> {
          Log.w(TAG, "인제스트 보류 (HTTP $code) — 큐에 남기고 다음에 재시도")
          Outcome.RETRY_LATER
        }

        // 400(스키마 불일치) 같은 건 같은 내용으로 몇 번을 보내도 결과가 같다.
        else -> {
          Log.w(TAG, "인제스트 거절됨 (HTTP $code) — 이 배치는 버린다")
          Outcome.DROP
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "인제스트 전송 실패: ${e.message}")
      Outcome.RETRY_LATER
    } finally {
      connection?.disconnect()
    }
  }

  private fun readQueue(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_QUEUE, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
  }
}
