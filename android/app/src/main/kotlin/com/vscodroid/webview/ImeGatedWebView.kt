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
 * Every editable surface in this app, the editor, the terminal, an extension
 * webview such as Cline, asks the WebView for an input connection. Leaving
 * that connection's type as text is what pops the IME on a tap. [InputType.TYPE_NULL]
 * keeps hardware keys and the extra key row working, and tells the input
 * method there is nothing to show. The keyboard button arms the view and
 * restarts input, which is the only path that gets a real text type.
 *
 * ## Why onCheckIsTextEditor as well as TYPE_NULL
 *
 * TYPE_NULL alone did not hold. It describes the connection that already
 * exists, so it reaches the input method after the WebView has decided it
 * wants a keyboard, and the keyboard came up and was then put back down by
 * the armed check in [com.vscodroid.MainActivity]: tapping Cline's composer
 * with the keyboard closed flashed it open and shut again.
 *
 * This is the question the WebView asks before it requests one, so a false
 * here means it never asks. The flash was not the button's behaviour being
 * wrong; it was the tap failing to stay suppressed, and this is the lever
 * that suppresses it rather than undoing it a frame later.
 *
 * Overridable because a subclass that wants the plain WebView behaviour --
 * a test harness, a host that shows its own bar -- has to be able to say so
 * without replacing the class.
 */
open class ImeGatedWebView @JvmOverloads constructor(
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

    /**
     * Whether the WebView may ask for the soft keyboard on its own.
     *
     * Armed is the only state in which it may: the keyboard button is the one
     * caller that sets [imeArmed], and it shows the keyboard itself rather
     * than waiting for this to answer yes.
     */
    override fun onCheckIsTextEditor(): Boolean = imeArmed
}
