package com.vscodroid.webview

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * The keyboard gate answers both questions, not one.
 *
 * `onCreateInputConnection` returning TYPE_NULL describes the connection that
 * already exists. It reaches the input method after the WebView has decided it
 * wants a keyboard, and by then the keyboard is already animating up. The armed
 * check in MainActivity then put it back down, so tapping Cline's composer with
 * the keyboard closed flashed it open and shut again.
 *
 * `onCheckIsTextEditor` is the question asked before the request, so answering
 * false means the request never happens. Both are required: keep only the
 * second and the connection reports a real text type whenever one exists;
 * keep only the first and the flash comes back.
 *
 * Source-scanned rather than instantiated: the answer is one line, and a test
 * that builds a WebView cannot run on the JVM anyway.
 */
class ImeGatedWebViewGateTest {

    private val source = File("src/main/kotlin/com/vscodroid/webview/ImeGatedWebView.kt")

    @Test
    fun `the view answers the pre-request question from the armed flag`() {
        val text = source.readText()
        assertTrue(
            text.contains("override fun onCheckIsTextEditor(): Boolean = imeArmed"),
            "onCheckIsTextEditor no longer answers from imeArmed; a tap on a " +
                "composer can raise the keyboard again, and the suppression " +
                "happens a frame too late to look like anything but a flash",
        )
    }

    @Test
    fun `the connection answer is still there`() {
        val text = source.readText()
        assertTrue(
            text.contains("InputType.TYPE_NULL"),
            "onCreateInputConnection no longer blanks the input type, so an " +
                "input connection that does exist would ask for a full keyboard",
        )
    }
}