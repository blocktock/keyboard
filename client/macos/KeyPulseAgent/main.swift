import AppKit
import ApplicationServices
import SwiftUI

enum KeyPulsePermissions {
    static var appPath: String { Bundle.main.bundleURL.path }

    static var hasAccessibility: Bool { AXIsProcessTrusted() }

    static var hasInputMonitoring: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightListenEventAccess()
        }
        return true
    }

    static var isReady: Bool { hasAccessibility && hasInputMonitoring }

    static func request() {
        if !hasAccessibility {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
        if #available(macOS 10.15, *) {
            if !hasInputMonitoring {
                _ = CGRequestListenEventAccess()
            }
        }
    }

    static func statusMessage() -> String {
        let lines = [
            "当前应用：\(appPath)",
            "辅助功能：\(hasAccessibility ? "已授权" : "未授权")",
            "输入监控：\(hasInputMonitoring ? "已授权" : "未授权")",
            "",
            "常见原因：之前授权给了 KeyPulseAgent 或旧版应用，系统不会自动迁移到新路径。",
            "请先在系统设置中删除旧的 KeyPulse / KeyPulseAgent 条目，",
            "再手动添加 /Applications/KeyPulse.app，然后完全退出并重新打开 KeyPulse。"
        ]
        return lines.joined(separator: "\n")
    }

    static func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    static func openInputMonitoringSettings() {
        let urls = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent"
        ]
        for raw in urls {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) { return }
        }
    }
}

enum KeyPulseLifecycle {
    static weak var sharedModel: KeyPulseModel?
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        ProcessInfo.processInfo.disableSuddenTermination()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        KeyPulseLifecycle.sharedModel?.prepareForQuit()
        return .terminateNow
    }
}

final class KeyPulseRecorder {
    private var counts: [String: Int] = [:]
    private var events: [KeyEvent] = []
    private var total = 0
    private var sessionStartedAt = Date()
    private let queue = DispatchQueue(label: "io.keypulse.aggregate")

    func resetSession() {
        queue.sync {
            counts.removeAll()
            events.removeAll()
            total = 0
            sessionStartedAt = Date()
        }
    }

    func record(key: String, timestampMs: Int64) {
        queue.async {
            self.counts[key, default: 0] += 1
            self.events.append(KeyEvent(key: key, timestampMs: timestampMs))
            self.total += 1
        }
    }

    func writeReport(to reportDirectory: URL) -> Result<URL, Error> {
        queue.sync {
            guard total > 0 else { return .failure(AgentError.emptySession) }
            do {
                try FileManager.default.createDirectory(at: reportDirectory, withIntermediateDirectories: true)
                let report = EventReport(
                    schemaVersion: 2,
                    startedAt: sessionStartedAt,
                    endedAt: Date(),
                    keyboardLayout: "ansi-75",
                    keyCounts: counts,
                    events: events,
                    totalKeyDowns: total
                )
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let data = try encoder.encode(report)
                let file = reportDirectory.appendingPathComponent("report-\(Int(Date().timeIntervalSince1970)).json")
                try data.write(to: file, options: .atomic)
                return .success(file)
            } catch {
                return .failure(error)
            }
        }
    }

    private enum AgentError: LocalizedError {
        case emptySession
        var errorDescription: String? { "这次会话没有收集到有效按键，因此未生成报告。" }
    }
}

final class KeyPulseModel: ObservableObject {
    @Published var isRecording = false
    @Published var statusText = "尚未开始记录"
    @Published var storageSummary = "存储：未设置"

    private var eventTap: CFMachPort?
    private var source: CFRunLoopSource?
    private let recorder = KeyPulseRecorder()
    private let configurationURL: URL
    private let configStore: KeyPulseConfigStore

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        configurationURL = support.appendingPathComponent("KeyPulse/config.json")
        configStore = KeyPulseConfigStore(configurationURL: configurationURL)
        ensureSupportDirectory()
        reloadStorageSummary()
        KeyPulseLifecycle.sharedModel = self
        showLaunchHintIfNeeded()
        promptStorageFolderIfNeeded()
    }

    var menuBarLabel: String { isRecording ? "KP●" : "KP" }
    var menuBarSymbol: String { isRecording ? "record.circle.fill" : "keyboard" }

    private var configuredReportDirectory: URL? {
        guard let path = configStore.load().reportDirectory, !path.isEmpty,
              KeyPulseStorage.isValidDirectory(path) else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    private var hasConfiguredStorage: Bool { configuredReportDirectory != nil }

    var hasConfiguredStorageForMenu: Bool { hasConfiguredStorage }

    private func reloadStorageSummary() {
        if let url = configuredReportDirectory {
            storageSummary = "存储：\(url.path)"
            if !isRecording { statusText = "存储目录已就绪" }
        } else {
            storageSummary = "存储：未设置"
            if !isRecording { statusText = "请先设置存储文件夹" }
        }
    }

    private func ensureSupportDirectory() {
        let support = configurationURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: configurationURL.path) {
            try? configStore.save(AgentConfiguration(reportDirectory: nil))
        }
    }

    private func showLaunchHintIfNeeded() {
        let key = "io.keypulse.launchHintShown.v3"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let alert = NSAlert()
            alert.messageText = "KeyPulse 已启动"
            alert.informativeText = "首次使用前请先设置报告存储文件夹，然后才能在菜单栏中开始记录。报告仅保存在本地，需在网页中手动上传分析。"
            alert.addButton(withTitle: "知道了")
            alert.runModal()
        }
    }

    private func promptStorageFolderIfNeeded() {
        guard !hasConfiguredStorage else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            _ = self.configureReportDirectory(prompt: "首次使用 KeyPulse 前，请选择报告 JSON 的存储文件夹。")
        }
    }

    @discardableResult
    func configureReportDirectory(prompt: String? = nil) -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "选择文件夹"
        panel.message = prompt ?? "选择 KeyPulse 报告存储文件夹"
        panel.directoryURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first

        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try KeyPulseStorage.ensureDirectory(at: url)
            var config = configStore.load()
            config.reportDirectory = url.path
            try configStore.save(config)
            reloadStorageSummary()
            return true
        } catch {
            showMessage(title: "无法使用该文件夹", message: error.localizedDescription)
            return false
        }
    }

    @discardableResult
    private func ensureReportDirectoryConfigured() -> Bool {
        if hasConfiguredStorage { return true }
        let alert = NSAlert()
        alert.messageText = "请先设置存储文件夹"
        alert.informativeText = "开始记录前必须指定报告保存位置。请选择本机上的一个文件夹。"
        alert.addButton(withTitle: "选择文件夹")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        return configureReportDirectory(prompt: "请选择报告 JSON 的存储文件夹。")
    }

    func checkPermissions() {
        showPermissionAlert()
    }

    func toggleRecording() {
        isRecording ? stopAndGenerateReport() : startRecording()
    }

    func openReportsFolder() {
        guard ensureReportDirectoryConfigured(), let reportDirectory = configuredReportDirectory else { return }
        NSWorkspace.shared.open(reportDirectory)
    }

    func quit() {
        prepareForQuit()
        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }

    func prepareForQuit() {
        tearDownEventTap()
    }

    private func tearDownEventTap() {
        if let eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
            CFMachPortInvalidate(eventTap)
        }
        if let source {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        eventTap = nil
        source = nil
        if isRecording {
            isRecording = false
            reloadStorageSummary()
        }
    }

    private func startRecording() {
        guard !isRecording else { return }
        guard ensureReportDirectoryConfigured() else { return }
        guard let reportDirectory = configuredReportDirectory else { return }
        if !KeyPulsePermissions.isReady {
            KeyPulsePermissions.request()
            showPermissionAlert()
            return
        }
        do {
            try KeyPulseStorage.ensureDirectory(at: reportDirectory)
        } catch {
            showMessage(title: "存储文件夹不可用", message: error.localizedDescription)
            reloadStorageSummary()
            return
        }
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, refcon in
                let model = Unmanaged<KeyPulseModel>.fromOpaque(refcon!).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = model.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
                } else if type == .keyDown {
                    model.handleKeyDown(event: event)
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        )
        guard let eventTap else {
            showMessage(
                title: "无法启动记录",
                message: "事件监听创建失败。\n\n\(KeyPulsePermissions.statusMessage())"
            )
            return
        }
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
        recorder.resetSession()
        isRecording = true
        statusText = "正在记录按键"
    }

    private func handleKeyDown(event: CGEvent) {
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        guard let key = Self.keyNames[code] else { return }
        let timestampMs = Int64((Date().timeIntervalSince1970 * 1_000).rounded())
        recorder.record(key: key, timestampMs: timestampMs)
    }

    private func stopAndGenerateReport() {
        guard isRecording else { return }
        tearDownEventTap()

        guard let reportDirectory = configuredReportDirectory else {
            showMessage(title: "存储文件夹未设置", message: "请先设置报告存储文件夹后再生成报告。")
            return
        }

        switch recorder.writeReport(to: reportDirectory) {
        case .success(let file):
            uploadReportAndCleanup(file: file)
        case .failure(let error):
            showMessage(title: "生成报告失败", message: error.localizedDescription)
        }
    }

    private static let serverURL = URL(string: "http://127.0.0.1:3011/api/reports")!

    private func uploadReportAndCleanup(file: URL) {
        statusText = "正在上传报告…"
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Self.uploadReport(at: file)
            DispatchQueue.main.async {
                self.reloadStorageSummary()
                switch result {
                case .success(let importToken):
                    try? FileManager.default.removeItem(at: file)
                    let pageURL = importToken.map { "http://127.0.0.1:3011/?importToken=\($0)" } ?? "http://127.0.0.1:3011"
                    if let page = URL(string: pageURL) {
                        NSWorkspace.shared.open(page)
                    }
                    self.showMessage(
                        title: "报告已上传",
                        message: "本地 JSON 已删除。\n\n浏览器将打开分析页面，可在网页导出热力图 PNG。"
                    )
                case .failure(let error):
                    self.showMessage(
                        title: "上传失败",
                        message: "\(error.localizedDescription)\n\n本地报告仍保留在：\n\(file.path)\n\n请确认已运行 npm run start，或在网页手动上传。"
                    )
                }
            }
        }
    }

    private static func uploadReport(at file: URL) -> Result<String?, Error> {
        do {
            var request = URLRequest(url: serverURL)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Data(contentsOf: file)
            request.timeoutInterval = 60

            let semaphore = DispatchSemaphore(value: 0)
            var uploadResult: Result<String?, Error> = .failure(NSError(domain: "KeyPulse", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "上传未完成"
            ]))

            URLSession.shared.dataTask(with: request) { data, response, error in
                defer { semaphore.signal() }
                if let error {
                    uploadResult = .failure(error)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    uploadResult = .failure(NSError(domain: "KeyPulse", code: -1, userInfo: [
                        NSLocalizedDescriptionKey: "无效的服务响应"
                    ]))
                    return
                }
                if (200...299).contains(http.statusCode) {
                    var token: String?
                    if let data,
                       let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let importToken = payload["importToken"] as? String {
                        token = importToken
                    }
                    uploadResult = .success(token)
                } else {
                    uploadResult = .failure(NSError(domain: "KeyPulse", code: http.statusCode, userInfo: [
                        NSLocalizedDescriptionKey: "上传失败（HTTP \(http.statusCode)）。请确认分析服务已启动。"
                    ]))
                }
            }.resume()

            semaphore.wait()
            return uploadResult
        } catch {
            return .failure(error)
        }
    }

    private func showPermissionAlert() {
        let alert = NSAlert()
        alert.messageText = "需要重新授权 KeyPulse"
        alert.informativeText = KeyPulsePermissions.statusMessage()
        alert.addButton(withTitle: "打开辅助功能")
        alert.addButton(withTitle: "打开输入监控")
        alert.addButton(withTitle: "取消")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            KeyPulsePermissions.openAccessibilitySettings()
        case .alertSecondButtonReturn:
            KeyPulsePermissions.openInputMonitoringSettings()
        default:
            break
        }
    }

    private func showMessage(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }

    fileprivate static let keyNames: [Int64: String] = [
        0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",
        18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",28:"8",29:"0",30:"]",31:"O",32:"U",34:"I",
        35:"P",36:"Enter",37:"L",38:"J",39:"'",40:"K",41:";",42:"\\",43:",",44:"/",45:"N",46:"M",47:".",48:"Tab",49:"Space",
        50:"`",51:"Backspace",53:"Esc",54:"Command",55:"Command",56:"Shift",57:"Caps",58:"Option",59:"Ctrl",
        60:"Shift",61:"Option",62:"Ctrl",63:"Fn",65:"Num.",67:"Num*",69:"Num+",71:"NumLock",75:"Num/",76:"NumEnter",
        78:"Num-",82:"Num0",83:"Num1",84:"Num2",85:"Num3",86:"Num4",87:"Num5",88:"Num6",89:"Num7",91:"Num8",92:"Num9",
        96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",101:"F9",103:"F11",109:"F10",111:"F12",
        114:"Insert",115:"Home",116:"PageUp",117:"Delete",118:"F4",119:"End",120:"F2",121:"PageDown",122:"F1",
        123:"Left",124:"Right",125:"Down",126:"Up"
    ]
}

struct KeyPulseMenuContent: View {
    @ObservedObject var model: KeyPulseModel

    var body: some View {
        Text(model.statusText).font(.caption).foregroundStyle(.secondary)
        Text(model.storageSummary).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        Divider()
        Button(model.isRecording ? "停止并生成报告" : "开始记录") { model.toggleRecording() }
            .disabled(!model.isRecording && !model.hasConfiguredStorageForMenu)
        Button("设置存储文件夹…") { model.configureReportDirectory() }
        Button("检查权限状态…") { model.checkPermissions() }
        Button("打开报告文件夹") { model.openReportsFolder() }
            .disabled(!model.hasConfiguredStorageForMenu)
        Divider()
        Button("退出 KeyPulse") { model.quit() }
    }
}

@main
struct KeyPulseApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = KeyPulseModel()

    var body: some Scene {
        MenuBarExtra {
            KeyPulseMenuContent(model: model)
        } label: {
            Label {
                Text(model.menuBarLabel)
            } icon: {
                Image(systemName: model.menuBarSymbol)
            }
        }
        .menuBarExtraStyle(.menu)
    }
}

struct KeyEvent: Codable { let key: String; let timestampMs: Int64 }
struct EventReport: Codable {
    let schemaVersion: Int
    let startedAt: Date
    let endedAt: Date
    let keyboardLayout: String
    let keyCounts: [String: Int]
    let events: [KeyEvent]
    let totalKeyDowns: Int
}
struct AgentConfiguration: Codable {
    var reportDirectory: String?
}

final class KeyPulseConfigStore {
    private let configurationURL: URL

    init(configurationURL: URL) {
        self.configurationURL = configurationURL
    }

    func load() -> AgentConfiguration {
        guard let data = try? Data(contentsOf: configurationURL),
              let config = try? JSONDecoder().decode(AgentConfiguration.self, from: data) else {
            return AgentConfiguration(reportDirectory: nil)
        }
        return config
    }

    func save(_ config: AgentConfiguration) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: configurationURL, options: .atomic)
    }
}

enum KeyPulseStorage {
    static func isValidDirectory(_ path: String) -> Bool {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return false
        }
        return FileManager.default.isWritableFile(atPath: path)
    }

    static func ensureDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        guard FileManager.default.isWritableFile(atPath: url.path) else {
            throw StorageError.notWritable
        }
    }

    enum StorageError: LocalizedError {
        case notWritable
        var errorDescription: String? { "所选文件夹不可写入，请重新选择。" }
    }
}

