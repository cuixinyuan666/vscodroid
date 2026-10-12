package com.vscodroid.keepalive

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * That the watchdog is wired where the service begins and ends a run, and
 * that the three ways the process is taken away each have an answer.
 *
 * Source-reading, and the weaker layer for the reason its neighbours in
 * `com.vscodroid.service` give: everything asserted here is a private method
 * on a `Service`, a manifest declaration or a document, and this suite can
 * build none of them. What it can do is refuse the two defects that are
 * otherwise silent:
 *
 *  - **A record written nowhere.** The resurrection alarm fires into a
 *    receiver that reads a flag nothing ever set, so nothing is resurrected
 *    and the only symptom is a server that stopped coming back. Nothing
 *    compiles differently and nothing logs.
 *  - **A record cleared nowhere.** The user presses Stop, the process dies,
 *    and the watchdog brings the server back anyway. That is worse: it is
 *    the app undoing an explicit instruction, with no screen saying so.
 *
 * The comment filter is load-bearing rather than tidiness. Every paragraph in
 * `NodeService.kt` names the calls below in prose, so a scan over raw text
 * reads documentation and passes on it.
 */
class KeepAliveWiringTest {

    private val nodeService = File("src/main/kotlin/com/vscodroid/service/NodeService.kt")
    private val receiver = File("src/main/kotlin/com/vscodroid/keepalive/KeepAliveReceiver.kt")
    private val manifest = File("src/main/AndroidManifest.xml")
    private val policy = File("../../docs/PRIVACY_POLICY.md")

    /** [file]'s lines with comments dropped, so prose cannot satisfy a search. */
    private fun codeLines(file: File): List<String> {
        check(file.isFile) {
            "${file.name} not found at ${file.absolutePath}; this test would otherwise " +
                "pass by reading nothing"
        }
        return file.readLines().filterNot {
            val t = it.trimStart()
            t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
        }
    }

    /** The body of [declaration], located by brace depth in [file]. */
    private fun bodyOf(file: File, declaration: String): String {
        val lines = codeLines(file)
        val start = lines.indexOfFirst { it.contains(declaration) }
        assertTrue(start >= 0, "$declaration is gone from ${file.name}; this guard names a method")
        val body = StringBuilder()
        var depth = 0
        var entered = false
        for (line in lines.drop(start)) {
            body.append(line).append('\n')
            depth += line.count { it == '{' } - line.count { it == '}' }
            if (depth > 0) entered = true
            if (entered && depth <= 0) break
        }
        return body.toString()
    }

    private fun report(hits: List<String>) =
        hits.joinToString("\n") { "  $it" }

    @Test
    fun `a run begins by recording that the user is owed a server`() {
        // The SERVE arm of onStartCommand, and the order inside it is the
        // assertion: the flag is written before the launch coroutine starts,
        // so a process death during the launch still leaves a record behind.
        val body = bodyOf(nodeService, "StartCommand.SERVE -> {")

        assertTrue(
            body.contains("KeepAliveState.markServerWanted(this)"),
            "a run that begins without recording that the user asked for it is a run " +
                "the watchdog cannot bring back:\n$body",
        )
        assertTrue(
            body.contains("KeepAliveScheduler.arm(this)"),
            "the run also has to arm the repeating alarm, or a kill between the " +
                "launch and the next boot is never answered:\n$body",
        )

        val markAt = body.indexOf("KeepAliveState.markServerWanted(this)")
        val launchAt = body.indexOf("launchServer()")
        assertTrue(launchAt >= 0 && markAt in 0 until launchAt) {
            "the record is written after the launch begins, so a death inside the " +
                "launch loses the only trace that a server was asked for"
        }
    }

    @Test
    fun `the two places the user says otherwise both take the record back`() {
        // Stop from the notification, and the give-up state the app enters
        // when a server has crashed more times than the budget allows. The
        // give-up page tells the user the server is not coming back; a record
        // left set there would let the watchdog take that sentence back.
        val shutdown = bodyOf(nodeService, "private fun shutdown(")
        assertTrue(
            shutdown.contains("KeepAliveState.clearServerWanted(this)") &&
                shutdown.contains("KeepAliveScheduler.disarm(this)"),
            "Stop must clear the record and cancel the alarm, or the watchdog " +
                "resurrects a server the user just stopped:\n$shutdown",
        )

        val recoverable = bodyOf(nodeService, "private fun stopServingRecoverably(")
        assertTrue(
            recoverable.contains("KeepAliveState.clearServerWanted(this)") &&
                recoverable.contains("KeepAliveScheduler.disarm(this)"),
            "the give-up state must clear the record and cancel the alarm too, or " +
                "the watchdog undoes the sentence the give-up page just showed:\n$recoverable",
        )

        // And exactly two writers, so a third place ending a run cannot forget
        // one of the two statements. The declaration in KeepAliveState.kt is a
        // different file and is not counted.
        val clears = codeLines(nodeService).filter { it.contains("KeepAliveState.clearServerWanted(") }
        assertEquals(
            2, clears.size,
            "exactly two places may clear the record, Stop and the give-up state:\n" +
                report(clears),
        )
    }

    /**
     * Ending a run still has one owner.
     *
     * `RecoverableStopCallSiteTest` pins that `stopServingRecoverably()` has
     * exactly two mentions in the file, its declaration and the one call in
     * `enterTerminalState`. This watchdog clears the flag from inside that
     * function rather than beside the call, precisely so the count stays at
     * two; a third mention here would redden that test, which is the point of
     * asserting it from this side as well.
     */
    @Test
    fun `the give-up path stays the one place a run ends recoverably`() {
        val mentions = codeLines(nodeService).filter { it.contains("stopServingRecoverably()") }
        assertEquals(
            2, mentions.size,
            "ending a run has one owner, and the keep-alive writes belong inside " +
                "it rather than beside its call:\n" + report(mentions),
        )
    }

    @Test
    fun `the gesture that ends the app without a word about the server is answered`() {
        val body = bodyOf(nodeService, "override fun onTaskRemoved(")

        assertTrue(
            body.contains("KeepAliveScheduler.scheduleTaskRemovalRestart("),
            "a task swiped from recents takes the process on half the phones this " +
                "app is built for, and nothing else answers it:\n$body",
        )
        assertTrue(
            body.contains("super.onTaskRemoved("),
            "the platform's own handling still has to run:\n$body",
        )
    }

    @Test
    fun `the running card carries the fix for the thing that kills the server most often`() {
        // An app the user has not exempted from battery restrictions is one
        // Android 12+ refuses to bring back from the background. The card is
        // the only surface that outlives the activity, so the fix belongs on
        // it, and it has to be derived rather than remembered so it disappears
        // the moment the exemption is granted.
        val body = bodyOf(nodeService, "private fun createNotification(")

        assertTrue(
            body.contains("KeepAliveTargets.batteryUnrestricted("),
            "the card offers the battery fix unconditionally, so it keeps offering " +
                "it after the user has taken it:\n$body",
        )
        assertTrue(
            body.contains("R.string.keep_alive_notification_action"),
            "the action is not on the card at all, so a user with no exemption has " +
                "no way to fix it from the one screen that outlives the app:\n$body",
        )
        assertTrue(
            body.contains("serverRunning &&"),
            "the fix is on the stopped card too, where the answer is a restart " +
                "rather than a settings page:\n$body",
        )
    }

    @Test
    fun `the resurrection start is guarded rather than thrown out of a receiver`() {
        // The same discipline `MainActivity.startAndBindService` holds: a
        // foreground start from the background is what Android 12+ refuses,
        // and an uncaught refusal in a BroadcastReceiver kills the process
        // that was coming back.
        val body = bodyOf(receiver, "override fun onReceive(")

        assertTrue(
            body.contains("ContextCompat.startForegroundService("),
            "the receiver no longer starts the service, so this guard is reading " +
                "a method that does something else:\n$body",
        )
        val tryAt = body.indexOf("try {")
        val callAt = body.indexOf("ContextCompat.startForegroundService(")
        assertTrue(tryAt in 0 until callAt) {
            "the start is unguarded, so a refusal takes the process down at the " +
                "one moment it was being brought back:\n$body"
        }
        assertTrue(body.contains("catch (")) {
            "there is no catch, so the guard above is measuring nothing:\n$body"
        }
    }

    @Test
    fun `the manifest declares the boot permission, the surviving service and the receiver`() {
        check(manifest.isFile) {
            "AndroidManifest.xml not found at ${manifest.absolutePath}; this test " +
                "would otherwise pass by reading nothing"
        }
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(manifest)

        val permissions = document.getElementsByTagName("uses-permission")
            .let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }
            .map { it.getAttribute("android:name") }
        assertTrue(
            permissions.contains("android.permission.RECEIVE_BOOT_COMPLETED"),
            "the receiver re-arms the alarms on BOOT_COMPLETED, which needs the " +
                "permission to be delivered at all. Found: $permissions",
        )

        val services = document.getElementsByTagName("service")
            .let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }
            .associateBy { it.getAttribute("android:name") }
        val service = services[".service.NodeService"]
        assertTrue(service != null, "NodeService is gone; found ${services.keys}")
        assertEquals(
            "false", service!!.getAttribute("android:stopWithTask"),
            "swiping the task away must not end a started service. The default is " +
                "already false; saying it out loud is what keeps the next reader " +
                "from changing it.",
        )

        val receivers = document.getElementsByTagName("receiver")
            .let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }
            .associateBy { it.getAttribute("android:name") }
        val keepAlive = receivers[".keepalive.KeepAliveReceiver"]
        assertTrue(keepAlive != null, "the keep-alive receiver is not declared; found ${receivers.keys}")
        assertEquals(
            "true", keepAlive!!.getAttribute("android:exported"),
            "BOOT_COMPLETED is a system broadcast and cannot reach a receiver that " +
                "is not exported. It is a protected broadcast, so only the system " +
                "can deliver it.",
        )
        val actions = keepAlive.getElementsByTagName("action")
            .let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }
            .map { it.getAttribute("android:name") }
        assertTrue(
            actions.contains("android.intent.action.BOOT_COMPLETED"),
            "the receiver listens for nothing it is declared for. Found: $actions",
        )
    }

    /**
     * The policy has to name the permission it now holds.
     *
     * `scripts/check-permission-claims.py` holds `docs/PRIVACY_POLICY.md` to
     * the manifest on every lint run, and it reads a permission as named only
     * where the document writes it in backticks. Adding the declaration
     * without the sentence reddens that gate on the way in; this says the
     * same thing from the side that can see both files.
     */
    @Test
    fun `the privacy policy names the permission the manifest now asks for`() {
        check(policy.isFile) {
            "PRIVACY_POLICY.md not found at ${policy.absolutePath}; this test would " +
                "otherwise pass by reading nothing"
        }
        val text = policy.readText()

        assertTrue(
            text.contains("seven Android permissions"),
            "the policy states a count, and the count is now seven. A stale count " +
                "is the document disagreeing with the app it describes.",
        )
        assertTrue(
            text.contains("`RECEIVE_BOOT_COMPLETED`"),
            "the permission is declared but not named in the policy, so a reader " +
                "checking the Play listing against this document finds one the " +
                "document never mentioned.",
        )
    }
}
