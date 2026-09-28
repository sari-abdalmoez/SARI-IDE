package com.sari.ide

import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.sari.ide.bridge.NativeBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val host = "appassets.androidplatform.net"
    private val origin = "https://$host"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val base = getExternalFilesDir(null) ?: filesDir
        bridge = NativeBridge(File(base, "SARIProjects"))

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
