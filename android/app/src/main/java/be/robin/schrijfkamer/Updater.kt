package be.robin.schrijfkamer

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Updates van de Android-app via de GitHub-releases (zelfde bron als de desktop-installer).
 * Stappen: zoeken -> downloaden -> controleren (pakket, hogere versie, zelfde sleutel) -> het
 * installatiescherm van Android openen. Bevestigen doet de gebruiker zelf; dat eist Android.
 *
 * De status heeft dezelfde vorm als bij de desktop (updater.js), zodat de webapp dezelfde knoppen toont:
 * idle | checking | current | available | downloading | permission | confirm | error.
 */
class Updater(private val activity: Activity, private val onStatus: (JSONObject) -> Unit) {

    private companion object {
        const val LATEST = "https://api.github.com/repos/robinbollens-commits/schrijfkamer/releases/latest"
        val APK_NAME = Regex("""^Schrijfkamer-[\d.]+\.apk$""")
    }

    @Volatile private var status = JSONObject().put("state", "idle")
    @Volatile private var apkUrl: String? = null
    @Volatile private var ready: File? = null   // gedownload en gecontroleerd, wacht op installatie

    private val info get() = activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    val installedVersion: String get() = info.versionName ?: "?"

    fun state(): JSONObject = JSONObject(status.toString()).put("installed", installedVersion)

    private fun send(next: JSONObject) {
        if (!next.has("version") && status.has("version")) next.put("version", status.getString("version"))
        status = next
        activity.runOnUiThread { onStatus(state()) }
    }
    private fun busy() = status.optString("state") in setOf("checking", "downloading")

    /** Zoekt naar een nieuwere APK; het resultaat komt via onStatus. */
    fun check() {
        if (busy()) return
        send(JSONObject().put("state", "checking"))
        thread {
            try {
                val c = (URL(LATEST).openConnection() as HttpURLConnection).apply {
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "Schrijfkamer-Android")
                    connectTimeout = 15000; readTimeout = 15000
                }
                if (c.responseCode != 200) error(if (c.responseCode == 403) "GitHub laat even geen vragen meer toe; probeer later opnieuw." else "GitHub antwoordde met ${c.responseCode}.")
                val rel = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                val version = rel.optString("tag_name").removePrefix("v")
                val assets = rel.optJSONArray("assets")
                var url: String? = null
                for (i in 0 until (assets?.length() ?: 0)) {
                    val a = assets!!.getJSONObject(i)
                    if (APK_NAME.matches(a.optString("name"))) url = a.optString("browser_download_url")
                }
                if (url != null && newer(version, installedVersion)) {
                    apkUrl = url
                    send(JSONObject().put("state", "available").put("version", version))
                } else {
                    send(JSONObject().put("state", "current").put("version", installedVersion))
                }
            } catch (e: Exception) {
                send(JSONObject().put("state", "error").put("message", nice(e)))
            }
        }
    }

    /** Eén tik: downloaden, controleren en het installatiescherm openen. */
    fun install() {
        ready?.let { if (it.exists()) { launchInstaller(it); return } }
        val url = apkUrl ?: return check()
        if (busy()) return
        send(JSONObject().put("state", "downloading").put("percent", 0))
        thread {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val file = File(dir, "Schrijfkamer-${status.optString("version", "update")}.apk")
                val c = (URL(url).openConnection() as HttpURLConnection).apply {
                    setRequestProperty("User-Agent", "Schrijfkamer-Android"); connectTimeout = 15000; readTimeout = 30000
                }
                if (c.responseCode != 200) error("Downloaden lukte niet (${c.responseCode}).")
                val total = c.contentLengthLong
                var done = 0L; var lastPct = -1
                c.inputStream.use { input -> file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        val pct = if (total > 0) (done * 100 / total).toInt() else 0
                        if (pct != lastPct && pct % 5 == 0) { lastPct = pct; send(JSONObject().put("state", "downloading").put("percent", pct)) }
                    }
                } }
                verify(file)
                ready = file
                activity.runOnUiThread { launchInstaller(file) }
            } catch (e: Exception) {
                send(JSONObject().put("state", "error").put("message", nice(e)))
            }
        }
    }

    /** Na terugkomen uit de Android-instellingen: verder installeren als de toestemming er nu is. */
    fun resume() {
        val f = ready ?: return
        if (status.optString("state") == "permission" && activity.packageManager.canRequestPackageInstalls()) launchInstaller(f)
    }

    private fun launchInstaller(file: File) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            send(JSONObject().put("state", "permission"))
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".files", file)
        send(JSONObject().put("state", "confirm"))
        activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    /** Alleen een echte, nieuwere Schrijfkamer met dezelfde sleutel wordt aangeboden. */
    private fun verify(file: File) {
        val pm = activity.packageManager
        val apk = pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("Het gedownloade bestand is geen geldige app.")
        if (apk.packageName != activity.packageName) error("Het gedownloade bestand is niet de Schrijfkamer.")
        if (apk.longVersionCode <= info.longVersionCode) error("De gedownloade versie is niet nieuwer dan deze.")
        val sha = { b: ByteArray -> MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) } }
        val mine = info.signingInfo?.apkContentsSigners?.map { sha(it.toByteArray()) }?.toSet().orEmpty()
        val theirs = apk.signingInfo?.apkContentsSigners?.map { sha(it.toByteArray()) }?.toSet()
        // Sommige Android-versies geven de sleutel van een los bestand niet; dan weigert de installer zelf een andere sleutel.
        if (theirs != null && theirs.isNotEmpty() && theirs != mine) { file.delete(); error("De update is niet met de juiste sleutel ondertekend.") }
    }

    private fun newer(a: String, b: String): Boolean {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }; val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) { val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }; if (x != y) return x > y }
        return false
    }

    private fun nice(e: Exception): String = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException -> "Geen internetverbinding."
        else -> e.message ?: e.javaClass.simpleName
    }
}
