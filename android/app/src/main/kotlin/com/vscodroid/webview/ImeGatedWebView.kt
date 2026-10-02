package com.vscodroid.webview

import android.content.Context
import android.text.InputType
import android.util.AttributeSet
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView

/**
 * The soft keyboard stays down until [imeArmed] is set.
 *
 * Every editable surface in this app — the editor, the terminal, an extension
 * webview such as Cline — asks the WebView for an input connection. Leaving
 * that connection's type as text is what pops the IME on a tap. [InputType.TYPE_NULL]
 * keeps hardware keys and the extra key row working, and tells the input
 * method there is nothing to show. The keyboard button arms the view and
 * restarts input, which is the only path that gets a real text type.
 */
class ImeGatedWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.webViewStyle,
) : WebView(context, attrs, defStyleAttr) {

    var imeArmed: Boolean = false

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs) ?: return null
        if (!imeArmed) outAttrs.inputType = InputType.TYPE_NULL
        return connection
    }
}
