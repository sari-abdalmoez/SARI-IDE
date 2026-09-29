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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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

    private val filesLauncher = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        pendingFiles?.complete(uris ?: emptyList()); pendingFiles = null
    }
    private val folderLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            try { contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) { }
        }
        pendingFolder?.complete(uri); pendingFolder = null
    }

    override suspend fun pickFiles(): List<Uri> {
        val d = CompletableDeferred<List<Uri>>()
        pendingFiles = d
        filesLauncher.launch(arrayOf("*/*"))
        return d.await()
    }

    override suspend fun pickFolder(): Uri? {
        val d = CompletableDeferred<Uri?>()
        pendingFolder = d
        folderLauncher.launch(null)
        return d.await()
    }

    override fun hasSharedStorageAccess(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()

    override fun openAllFilesAccessSettings() {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
            startActivity(intent)
        } catch (e: Exception) {
            try { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } catch (e2: Exception) {
                Toast.makeText(this, "Open Settings > Apps > SARI IDE > Permissions to grant file access", Toast.LENGTH_LONG).show()
            }
        }
    }

    /** Public shared storage (reachable by Termux too) when granted; otherwise app-private storage. */
    private fun projectsRootDir(): File =
        if (hasSharedStorageAccess()) File(Environment.getExternalStorageDirectory(), "SARIProjects")
        else File(getExternalFilesDir(null) ?: filesDir, "SARIProjects")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = NativeBridge(applicationContext, projectsRootDir(), this, this)
        if (!hasSharedStorageAccess()) {
            Toast.makeText(this, "Tip: enable file access in Settings to let Termux build and run your projects", Toast.LENGTH_LONG).show()
        }

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
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            // The UI never navigates; block every navigation attempt.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(this, "Please update Android System WebView", Toast.LENGTH_LONG).show()
            return
        }

        // Native bridge: reachable only from the app's own origin, main frame only.
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

        webView.loadUrl("$origin/assets/web/index.html")
    }

    override fun onDestroy() {
        scope.cancel()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
