package be.robin.schrijfkamer

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * De Schrijfkamer als eigen Android-app: een volledig scherm met een WebView die de online
 * Schrijfkamer laadt. Inloggen, synchroniseren en offline werken doet de webapp zelf
 * (Firebase + service worker); deze klasse regelt alleen wat een browser anders zou doen:
 * bestanden kiezen, bestanden bewaren, de terugknop en links naar buiten.
 */
class MainActivity : ComponentActivity() {

    private companion object {
        const val ORIGIN = "https://robinbollens-commits.github.io"
        const val START = "$ORIGIN/schrijfkamer/"
        const val PAPER = 0xFF14110E.toInt()
    }

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var bridge: androidx.webkit.JavaScriptReplyProxy? = null
    // Elke statuswijziging van een update gaat ongevraagd naar de webapp, zoals bij de desktop.
    private val updater by lazy { Updater(this) { s -> bridge?.postMessage(JSONObject().put("type", "update").put("status", s).toString()) } }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback
        fileCallback = null
        cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        // Alleen in een debug-build: de webinhoud is dan te inspecteren via chrome://inspect.
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this).apply { setBackgroundColor(PAPER) }
        val root = FrameLayout(this).apply {
            setBackgroundColor(PAPER)
            addView(web, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        // De app tekent niet onder de statusbalk, de navigatiebalk of het toetsenbord.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage en IndexedDB (Firebase, offline)
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100                    // opmaak zoals in de browser
            setSupportZoom(false)
        }

        // De webapp herkent aan dit kenmerk dat ze in deze app draait en welke versie dat is (voor de updateknoppen).
        web.settings.userAgentString = web.settings.userAgentString + " SchrijfkamerAndroid/" + updater.installedVersion

        // Brug met de webapp: alleen berichten van de eigen website worden aangenomen.
        //   {type:'save', id, filename, mime, data}  -> bestand in Downloads/Schrijfkamer
        //   {type:'update-state'|'update-check'|'update-install', id} -> updates (status komt ook ongevraagd)
        // Berichten zonder type zijn "save" (zo stuurde de webapp ze vóór 1.9.1).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "SchrijfkamerAndroid", setOf(ORIGIN)) { _, message, _, isMainFrame, reply ->
                if (!isMainFrame) return@addWebMessageListener
                val o = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                bridge = reply
                val id = o.optInt("id", 0)
                val answer = { r: JSONObject -> reply.postMessage(r.put("id", id).toString()) }
                when (o.optString("type", "save")) {
                    "update-state" -> answer(JSONObject().put("status", updater.state()))
                    "update-check" -> { updater.check(); answer(JSONObject().put("status", updater.state())) }
                    "update-install" -> { updater.install(); answer(JSONObject().put("status", updater.state())) }
                    else -> thread {
                        val result = runCatching { saveDownload(o) }
                        runOnUiThread {
                            result.onSuccess { name -> Toast.makeText(this, "Bewaard in Downloads/Schrijfkamer: $name", Toast.LENGTH_LONG).show() }
                                .onFailure { Toast.makeText(this, "Bewaren lukte niet", Toast.LENGTH_LONG).show() }
                            // Een webapp van vóór 1.9.1 verwacht een kale "ok"; een nieuwere stuurt een id mee.
                            if (id == 0) reply.postMessage(if (result.isSuccess) "ok" else "error")
                            else answer(JSONObject().put("ok", result.isSuccess))
                        }
                    }
                }
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "https" && u.host == Uri.parse(ORIGIN).host && (u.path ?: "").startsWith("/schrijfkamer")) return false
                // Alles daarbuiten (links in je notities, mailto:, …) opent in de gewone apps.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    pickFiles.launch(params.createIntent()); true
                } catch (e: Exception) {
                    fileCallback = null; false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) web.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
        }

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(START)
    }

    override fun onResume() {
        super.onResume()
        updater.resume()   // terug uit "Apps installeren toestaan": verder met de update
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /** Bewaart een bestand van de webapp in Downloads/Schrijfkamer; geeft de bestandsnaam terug. */
    private fun saveDownload(o: JSONObject): String {
        val name = o.optString("filename", "schrijfkamer.txt").replace(Regex("""[\\/:*?"<>|]"""), "_").ifBlank { "schrijfkamer.txt" }
        val mime = o.optString("mime", "application/octet-stream").ifBlank { "application/octet-stream" }
        val bytes = Base64.decode(o.getString("data"), Base64.DEFAULT)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Schrijfkamer")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("geen plek in Downloads")
        try {
            contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
            values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
        } catch (e: Exception) {
            contentResolver.delete(uri, null, null); throw e
        }
        return name
    }
}
