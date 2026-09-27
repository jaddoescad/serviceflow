import AVFoundation
import Observation
import Speech

/// Live speech-to-text for capture notes. One field dictates at a time.
@MainActor
@Observable
final class CameraDictation {
    /// The capture whose note is being dictated.
    private(set) var activeId: String?
    private(set) var error: String?

    @ObservationIgnored private let audioEngine = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var onText: ((String) -> Void)?
    @ObservationIgnored private var onEnd: (() -> Void)?

    var isActive: Bool { activeId != nil }

    /// Starts dictating. `prefix` is the text already in the field; the
    /// transcript is appended after it.
    func start(id: String, prefix: String, onText: @escaping (String) -> Void, onBegin: @escaping () -> Void,
               onEnd: @escaping () -> Void) {
        stop()
        error = nil
        Task {
            guard await Self.requestSpeech(), await Self.requestMicrophone() else {
                error = "Allow Speech Recognition and Microphone for ServiceFlow in Settings to dictate notes."
                return
            }
            guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
                error = "Dictation isn't available right now."
                return
            }
            onBegin()
            self.onEnd = onEnd
            self.onText = onText
            do {
                try begin(recognizer: recognizer, prefix: prefix)
                activeId = id
            } catch {
                self.error = "Dictation couldn't start."
                finish()
                onEnd()
                self.onEnd = nil
            }
        }
    }

    private func begin(recognizer: SFSpeechRecognizer, prefix: String) throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = false }
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()

        let base = prefix.trimmingCharacters(in: .whitespacesAndNewlines)
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            Task { @MainActor in
                guard let self else { return }
                if let text { self.onText?(base.isEmpty ? text : "\(base) \(text)") }
                if error != nil || isFinal { self.finish() }
            }
        }
    }

    func stop() {
        request?.endAudio()
        finish()
    }

    private func finish() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        task?.cancel()
        task = nil
        request = nil
        let wasActive = activeId != nil
        activeId = nil
        onText = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if wasActive { onEnd?() }
        onEnd = nil
    }

    private static func requestSpeech() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
            }
        default: return false
        }
    }

    private static func requestMicrophone() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .undetermined: return await AVAudioApplication.requestRecordPermission()
        default: return false
        }
    }
}
