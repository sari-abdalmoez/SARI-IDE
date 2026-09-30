package com.sari.ide

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.sari.ide.bridge.DocumentPicker
import com.sari.ide.bridge.NativeBridge
import com.sari.ide.bridge.SystemActions
import com.sari.ide.bridge.TermuxBridge
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.consumeEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : AppCompatActivity(), DocumentPicker, SystemActions {

    private lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val host = "appassets.androidplatform.net"
    private val origin = "https://$host"

    private var pendingFiles: CompletableDeferred<List<Uri>>? = null
    private var pendingFolder: CompletableDeferred<Uri?>? = null
    private var pendingTermuxPerm: CompletableDeferred<Boolean>? = null
    private var webViewReplyProxy: WebViewCompat.WebMessageListener? = null
    @Volatile private var lastReplyPort: androidx.webkit.WebMessagePortCompat? = null

    private val filesLauncher = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        pendingFiles?.complete(uris ?: emptyList()); pendingFiles = null
    }
    private val folderLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) { }
        }
        pendingFolder?.complete(uri); pendingFolder = null
    }
    private val termuxPermLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingTermuxPerm?.complete(granted); pendingTermuxPerm = null
    }

    override suspend fun pickFiles(): List<Uri> {
        val d = CompletableDeferred<List<Uri>>(); pendingFiles = d; filesLauncher.launch(arrayOf("*/*")); return d.await()
    }
    override suspend fun pickFolder(): Uri? {
        val d = CompletableDeferred<Uri?>(); pendingFolder = d; folderLauncher.launch(null); return d.await()
    }
    override suspend fun ensureTermuxPermission(): Boolean {
        if (TermuxBridge.hasPermission(this)) return true
        val d = CompletableDeferred<Boolean>(); pendingTermuxPerm = d
        termuxPermLauncher.launch(TermuxBridge.PERMISSION); return d.await()
    }
    override fun hasSharedStorageAccess(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
    override fun openAllFilesAccessSettings() {
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
        } catch (e: Exception) {
            try { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } catch (e2: Exception) {
                Toast.makeText(this, "Open Settings > Apps > SARI IDE > Permissions to grant file access", Toast.LENGTH_LONG).show()
            }
        }
    }
    private fun projectsRootDir(): File {
        // Always use the primary shared external storage so Termux can reach the same files
        // via its ~/storage/shared symlink.  We always use this path — not app-private scoped
        // storage — because /storage/emulated/0/Android/data/com.sari.ide/... is NOT
        // accessible to Termux even when allow-external-apps=true is set.
        val root = File(Environment.getExternalStorageDirectory(), "SARIProjects")
        root.mkdirs()
        return root
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bridge = NativeBridge(applicationContext, projectsRootDir(), this, this)
        TermuxBridge.permissionChecker = { ensureTermuxPermission() }

        webView = WebView(this)
        setContentView(webView)

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(host)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(this, "Please update Android System WebView", Toast.LENGTH_LONG).show()
            return
        }

        // Coroutine to drain the stream channel and forward output lines to the WebView
        scope.launch {
            bridge.streamChannel.consumeEach { msg ->
                withContext(Dispatchers.Main) {
                    webView.evaluateJavascript("window._onNativeStream && window._onNativeStream(${escapeJs(msg)})", null)
                }
            }
        }

        // Native bridge: single listener, main frame + app origin only
        WebViewCompat.addWebMessageListener(
            webView, "SariNative", setOf(origin)
        ) { _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply ->
            if (!isMainFrame || sourceOrigin.toString() != origin) return@addWebMessageListener
            val text = message.data ?: return@addWebMessageListener
            scope.launch {
                val response = withContext(Dispatchers.IO) { bridge.handle(text) }
                reply.postMessage(response)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.sariBack ? window.sariBack() : false") { r ->
                    if (r != "true") finish()
                }
            }
        })

        if (!hasSharedStorageAccess()) {
            Toast.makeText(this, "SARI IDE needs full file access so Termux can reach your projects. Grant it in the next screen.", Toast.LENGTH_LONG).show()
            openAllFilesAccessSettings()
        }
        webView.loadUrl("$origin/assets/web/index.html")
    }

    private fun escapeJs(s: String): String = "'${s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "").replace("</", "<\\/")  }'"

    override fun onDestroy() {
        scope.cancel()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
