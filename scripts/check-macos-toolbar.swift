// Run against an isolated, running Tinytune instance with an empty library:
// swift scripts/check-macos-toolbar.swift <pid>
// The terminal needs macOS Accessibility permission. The test uses the app's zh-Hans labels.
import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(EXIT_FAILURE)
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fail(message) }
}

func unwrap<T>(_ value: T?, _ message: String) -> T {
    guard let value else { fail(message) }
    return value
}

func attribute<T>(_ element: AXUIElement, _ key: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value as? T
}

func elements(in root: AXUIElement) -> [AXUIElement] {
    let children: [AXUIElement] = attribute(root, "AXChildren") ?? []
    return [root] + children.flatMap { elements(in: $0) }
}

func has(_ element: AXUIElement, _ key: String, _ expected: String) -> Bool {
    attribute(element, key) == expected
}

func isButton(_ element: AXUIElement, _ name: String) -> Bool {
    has(element, "AXRole", "AXButton") &&
        (has(element, "AXDescription", name) || has(element, "AXTitle", name))
}

func xPosition(_ element: AXUIElement) -> CGFloat? {
    guard let value: AXValue = attribute(element, "AXPosition") else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(value, .cgPoint, &point) ? point.x : nil
}

func waitFor(_ condition: () -> Bool) -> Bool {
    for _ in 0..<40 {
        if condition() { return true }
        Thread.sleep(forTimeInterval: 0.1)
    }
    return false
}

func press(_ element: AXUIElement) -> Bool {
    AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
}

func sendKey(to pid: pid_t, key: CGKeyCode = 0, flags: CGEventFlags = [], text: String? = nil) {
    for isDown in [true, false] {
        let event = unwrap(CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: isDown), "Create test key event")
        event.flags = flags
        if let text, isDown {
            let characters = Array(text.utf16)
            event.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: characters)
        }
        event.postToPid(pid)
    }
}

require(AXIsProcessTrusted(), "Grant Accessibility permission before running the UI check")
let args = CommandLine.arguments
let pid = unwrap(args.count == 2 ? Int32(args[1]) : nil, "Pass the PID of the isolated Tinytune instance")
require(pid > 0, "Pass a valid process ID")
let app = AXUIElementCreateApplication(pid)
let windows: [AXUIElement] = attribute(app, "AXWindows") ?? []
let window = unwrap(windows.first { has($0, "AXIdentifier", "library") }, "Open Tinytune's library window first")

func toolbarControls() -> [AXUIElement] {
    let toolbar = unwrap(elements(in: window).first { has($0, "AXRole", "AXToolbar") }, "Library window has no toolbar")
    return elements(in: toolbar)
}

let controls = toolbarControls()
let sources = unwrap(controls.first { isButton($0, "来源") }, "The toolbar must contain an independent Sources button")
let addFolder = unwrap(controls.first { isButton($0, "添加文件夹") }, "Keep Add Folder in the toolbar")
let search = unwrap(controls.first { has($0, "AXSubrole", "AXSearchField") }, "Keep native search in the toolbar")
let sourceX = unwrap(xPosition(sources), "Could not read Sources position")
let addX = unwrap(xPosition(addFolder), "Could not read Add Folder position")
let searchX = unwrap(xPosition(search), "Could not read search position")
require(sourceX < addX && addX < searchX, "Toolbar order must be Sources, Add Folder, Search")
let split = unwrap(elements(in: window).first { has($0, "AXRole", "AXSplitGroup") }, "Keep the sidebar visible for this test")
let columns: [AXUIElement] = attribute(split, "AXChildren") ?? []
let sidebar = elements(in: unwrap(columns.first, "Locate library sidebar"))
require(!sidebar.contains { element in
    has(element, "AXRole", "AXButton") && (attribute(element, "AXDescription") as String? ?? "").hasPrefix("来源")
}, "Remove the old Sources entry from the sidebar")
require((attribute(sources, "AXHelp") as String? ?? "").contains("尚未添加文件夹"), "Preserve empty source status in toolbar help")

// AXValue alone changes the AppKit field without driving SwiftUI's searchable binding.
NSRunningApplication(processIdentifier: pid)?.activate()
require(AXUIElementSetAttributeValue(search, "AXFocused" as CFString, kCFBooleanTrue) == .success,
        "The native search field must be focusable")
require(waitFor { attribute(search, "AXFocused") == true }, "Wait for native search focus")
sendKey(to: pid, text: "toolbar-check")
require(waitFor { has(window, "AXTitle", "搜索结果") }, "Native search must open results")
require(press(unwrap(toolbarControls().first { isButton($0, "来源") }, "Keep Sources available while searching")),
        "The Sources button must be actionable from search results")
require(waitFor { has(window, "AXTitle", "来源") }, "Sources must clear search and navigate to the Sources page")
require(waitFor { elements(in: window).contains { has($0, "AXValue", "尚未添加文件夹") } },
        "Show the existing empty Sources page")

func folderPicker() -> AXUIElement? {
    let children: [AXUIElement] = attribute(window, "AXChildren") ?? []
    let windows: [AXUIElement] = attribute(app, "AXWindows") ?? []
    return (children + windows).first { has($0, "AXIdentifier", "open-panel") }
}

func checkPicker(_ action: String, open: () -> Void) {
    open()
    require(waitFor { folderPicker() != nil }, "\(action) must open the native folder picker")
    let panel = unwrap(folderPicker(), "Locate the folder picker")
    let cancel = unwrap(elements(in: panel).first { has($0, "AXIdentifier", "CancelButton") }, "Locate the picker Cancel button")
    require(press(cancel), "Cancel the picker without importing")
    require(waitFor { folderPicker() == nil }, "Wait for the picker to close")
}

checkPicker("Add Folder") {
    require(press(unwrap(toolbarControls().first { isButton($0, "添加文件夹") }, "Keep Add Folder available on Sources")),
            "The toolbar Add Folder button must be actionable")
}
checkPicker("Command-O") { sendKey(to: pid, key: CGKeyCode(kVK_ANSI_O), flags: .maskCommand) }
require(press(unwrap(sidebar.first { isButton($0, "歌手") }, "Keep Artists in the sidebar")), "Return to the music library")
require(waitFor { has(window, "AXTitle", "音乐库") }, "The sidebar must still navigate back to the library")
print("PASS: Toolbar order, source help and navigation, native search, folder picker and Command-O")
