import Foundation
import AVFoundation
import Speech

// Voice input on the Mac for Page Aura and Page Orbit (docs/voice-input.md, "macOS: Swift, linked into the Rust app").
// Ported from Page Studio's verified dictation engines (DictationAnalyzerEngine, DictationRecognizerEngine,
// DictationMicTap, DictationEngine, DictationProbe and DictationPermissions from DictationController, and
// PageCore's DictationEngineChoice, DictationLocale and DictationLevel). What stays in the page's JavaScript and
// is therefore NOT here: the draft, the one-line cleanup, the 20 s silence limit and the 10 min cap, the guard
// against typing, and every word of copy.
//
// The order on the Mac, as in Page Studio: SpeechAnalyzer with SpeechTranscriber, then DictationTranscriber (both
// macOS 26 and later, on the Mac), then SFSpeechRecognizer on the Mac, then Apple's speech service
// (SFSpeechRecognizer with `requiresOnDeviceRecognition = false`). The line the person sees names the service
// whenever audio leaves the Mac. Nothing here records, stores, logs or uploads audio or words.
//
// C ABI (all three functions return at once and do their work on the main queue, in call order):
//
//   pd_start(cb, ctx)  Starts a session and cancels the current one first. `cb(json, ctx)` gets one event per call,
//                      as a NUL-terminated UTF-8 JSON object with a string `t` (see the table in the spec). Called
//                      on the main thread, never from inside a `pd_*` call.
//   pd_stop()          Closes the microphone, finalises what was heard, delivers it, then ends with `ended`.
//   pd_cancel()        Closes the microphone and drops everything: no more events.
//
// A session says exactly one terminal event last (`ended`, `interrupted`, `denied`, `unavailable` or `failed`),
// unless it is cancelled, which says nothing. After that, `cb(NULL, ctx)` is called exactly once and `ctx` is never
// touched again: that is the moment the owner may free it.
//
// The macOS 26 SDK arrived with Swift 6.2, so everything that names SpeechAnalyzer, SpeechTranscriber or
// DictationTranscriber sits behind `#if compiler(>=6.2) && !PD_NO_ANALYZER` and `@available(macOS 26.0, *)`. An older
// Xcode builds the SFSpeechRecognizer path alone. (`-D PD_NO_ANALYZER` builds that path with a new compiler.)

// MARK: - What an engine tells the session

/// Every closure is called on the main thread, and an engine says nothing more once it has been cancelled or has ended.
struct DictationEngineEvents {
    /// A language model is being fetched by macOS (nil: no percentage to show).
    var downloading: (Double?) -> Void
    /// The microphone is open and the recognizer is running.
    var listening: () -> Void
    /// The words still changing (replaces the last ones).
    var volatile: (String) -> Void
    /// Words that are final.
    var commit: (String) -> Void
    var ended: (DictationEngineEnd) -> Void
}

enum DictationEngineEnd: Equatable {
    /// Done after `stop()`: the last words have been delivered.
    case finished
    /// Never started listening (the language's model is unsupported or could not be fetched, the recognizer is not
    /// available): the session tries the next engine.
    case cannotStart
    /// The default input changed or failed, or the recognizer gave up, while listening or opening the microphone.
    /// What was heard has been delivered.
    case interrupted
    /// The recognizer is there but will not run (Dictation is off in System Settings, say).
    case refused
}

protocol DictationEngine: AnyObject {
    /// The voice level, 0...1. Safe to read from the main thread at any time.
    var level: Double { get }
    /// Starts asynchronously and reports through its events.
    func start()
    /// Closes the microphone now, finalises what was heard, delivers it and ends with `.finished`.
    func stop()
    /// Closes the microphone now and drops everything: no more events.
    func cancel()
}

// MARK: - The audio input

/// Where an engine's audio comes from: the microphone in the app. (A seam so a test can feed a file instead.)
protocol DictationAudioInput: AnyObject {
    /// The voice level, 0...1, as of the last buffer. Safe to read from any thread.
    var level: Double { get }
    /// The default input changed or the engine stopped under us. Called on the main thread. The input is already stopped.
    var onInterrupt: (() -> Void)? { get set }
    /// Opens the input. `onBuffer` is called on an audio thread for every buffer.
    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws
    /// Closes the input. Safe to call twice.
    func stop()
}

// The microphone for voice input: an AVAudioEngine input tap, shared by both engines. macOS has no AVAudioSession, so
// the engine reads the default input device directly. Nothing here writes audio to disk or sends it anywhere: each
// buffer goes straight to the recognizer that asked for it, and the tap is removed the moment listening stops (the
// microphone is open only while the stop square shows).
//
// AVAudioEngine raises Objective-C exceptions (which Swift cannot catch) for a tap installed twice, a tap whose format
// differs from the hardware's, and an input with no sample rate or no channels (a Mac without a microphone). So the
// tap is always removed first, installed with the input's own format, and only installed when that format is usable.

final class DictationMicTap: DictationAudioInput {
    struct Failure: Error, Equatable {
        let reason: String
    }

    private var engine: AVAudioEngine?
    private var configObserver: NSObjectProtocol?
    private let lock = NSLock()
    private var smoothed = 0.0

    var level: Double {
        lock.lock(); defer { lock.unlock() }
        return smoothed
    }

    var onInterrupt: (() -> Void)?

    deinit { stop() }

    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        stop()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure(reason: "no usable input") }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            self?.measure(buffer)
            onBuffer(buffer)
        }
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            guard let self, self.engine != nil else { return }
            self.stop()
            self.onInterrupt?()
        }
        self.engine = engine
        engine.prepare()
        do {
            try engine.start()
        } catch {
            stop()
            throw Failure(reason: error.localizedDescription)
        }
    }

    func stop() {
        if let o = configObserver { NotificationCenter.default.removeObserver(o) }
        configObserver = nil
        if let e = engine {
            e.inputNode.removeTap(onBus: 0)
            e.stop()
        }
        engine = nil
        lock.lock(); smoothed = 0; lock.unlock()
    }

    /// The RMS of channel 0, as a bar level (`DictationLevel`).
    private func measure(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return }
        let n = Int(buffer.frameLength)
        let samples = channels[0]
        var sum: Float = 0
        for i in 0..<n { sum += samples[i] * samples[i] }
        let rms = Double((sum / Float(n)).squareRoot())
        let next = DictationLevel.level(rms: rms)
        lock.lock()
        smoothed = DictationLevel.smoothed(previous: smoothed, next: next)
        lock.unlock()
    }
}

/// Converts the input's buffers to the format the analyzer wants. Used on the audio thread only.
final class DictationBufferConverter: @unchecked Sendable {
    private let target: AVAudioFormat
    private var converter: AVAudioConverter?
    private var source: AVAudioFormat?

    init(to target: AVAudioFormat) { self.target = target }

    /// A new buffer in the target format, or nil if this one could not be converted.
    func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if converter == nil || source != buffer.format {
            source = buffer.format
            converter = AVAudioConverter(from: buffer.format, to: target)
        }
        guard let converter, buffer.format.sampleRate > 0 else { return nil }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, inputStatus in
            if fed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, error == nil, out.frameLength > 0 else { return nil }
        return out
    }
}

enum DictationLevel {
    /// A buffer's RMS (0...1 of full scale) as a bar level 0...1: -55 dB and below is 0, -15 dB and above is 1.
    static func level(rms: Double) -> Double {
        guard rms > 0, rms.isFinite else { return 0 }
        let db = 20 * log10(rms)
        return min(1, max(0, (db + 55) / 40))
    }

    /// The bars rise at once and fall a little at a time, so they read as a voice and not a flicker.
    static func smoothed(previous: Double, next: Double) -> Double {
        next >= previous ? next : max(next, previous * 0.8)
    }
}

// MARK: - Which engine listens

enum DictationUnavailable: Equatable {
    /// No path (on the Mac or Apple's service) supports this language (its display name).
    case language(String)
    /// The Mac has no speech recognizer at all.
    case noRecognizer
}

enum DictationEngineChoice: Equatable {
    /// macOS 26+: SpeechAnalyzer with SpeechTranscriber, on the Mac.
    case speechTranscriber
    /// macOS 26+: SpeechAnalyzer with DictationTranscriber, on the Mac.
    case dictationTranscriber
    /// SFSpeechRecognizer with `requiresOnDeviceRecognition = true`.
    case recognizerOnDevice
    /// SFSpeechRecognizer on Apple's speech service (the last resort, and the line says so).
    case recognizerServer
    case unavailable(DictationUnavailable)

    /// The first major version with SpeechAnalyzer.
    static let analyzerMajor = 26

    /// The engine to use, on the Mac first: SpeechTranscriber, DictationTranscriber, SFSpeechRecognizer on the device,
    /// then SFSpeechRecognizer on Apple's server. A language that one path lacks falls through to the next, so the
    /// language line only shows when no path has it. A runtime failure (a model that won't install) calls `pick` again
    /// with that engine's input set to false.
    static func pick(osMajor: Int, transcriberAvailable: Bool, transcriberSupportsLocale: Bool,
                     dictationSupportsLocale: Bool, sfSupportsLocale: Bool, sfOnDevice: Bool, sfAvailable: Bool,
                     language: String) -> DictationEngineChoice {
        let analyzer = osMajor >= analyzerMajor
        if analyzer, transcriberAvailable, transcriberSupportsLocale { return .speechTranscriber }
        if analyzer, dictationSupportsLocale { return .dictationTranscriber }
        if sfSupportsLocale, sfAvailable { return sfOnDevice ? .recognizerOnDevice : .recognizerServer }
        // Nothing can listen. A language no path knows is its own line; the rest is "no recognizer".
        let someoneKnowsIt = sfSupportsLocale || (analyzer && (transcriberSupportsLocale || dictationSupportsLocale))
        return .unavailable(someoneKnowsIt ? .noRecognizer : .language(language))
    }

    /// The words stay on this Mac (false: Apple's speech service listens, or nothing does).
    var isOnDevice: Bool {
        switch self {
        case .speechTranscriber, .dictationTranscriber, .recognizerOnDevice: return true
        case .recognizerServer, .unavailable: return false
        }
    }
}

/// The nearest language a recognizer lists, by identifier.
enum DictationLocale {
    /// The identifier in `supported` nearest to `wanted`: the same one (`en_GB` and `en-GB` are the same), else the
    /// same language in the same region, else the same language (the first in sort order). nil when no supported
    /// identifier shares the language.
    static func nearest(to wanted: String, in supported: [String]) -> String? {
        let w = parts(wanted)
        let candidates = supported.map { ($0, parts($0)) }.filter { $0.1.language == w.language }
        if let exact = candidates.first(where: { $0.1 == w }) { return exact.0 }
        if let region = w.region, let same = candidates.first(where: { $0.1.region == region }) { return same.0 }
        return candidates.map { $0.0 }.sorted().first
    }

    /// "en_GB", "en-GB", "zh-Hans_CN": the lower-case language, and the region (two letters or three digits) if any.
    static func parts(_ identifier: String) -> (language: String, region: String?) {
        // "en_US@calendar=gregorian": the part after @ is a setting, not a language or a region.
        let core = identifier.split(separator: "@", maxSplits: 1).first.map(String.init) ?? ""
        let bits = core.split(whereSeparator: { $0 == "_" || $0 == "-" }).map(String.init)
        guard let first = bits.first else { return ("", nil) }
        let region = bits.dropFirst().last { ($0.count == 2 && $0.allSatisfy { $0.isLetter }) || ($0.count == 3 && $0.allSatisfy { $0.isNumber }) }
        return (first.lowercased(), region?.uppercased())
    }
}

// MARK: - SpeechAnalyzer (macOS 26 and later)

/// What this Mac's transcribers say about a language. Used to choose the engine.
struct DictationTranscriberSupport {
    var speechTranscriberAvailable = false
    var speechLocale: Locale?
    var dictationLocale: Locale?
}

#if compiler(>=6.2) && !PD_NO_ANALYZER

enum DictationAnalyzerKind {
    case speech, dictation
}

/// The engine for `kind`, or nil on a macOS that does not have the transcribers.
func makeDictationAnalyzerEngine(kind: DictationAnalyzerKind, locale: Locale, events: DictationEngineEvents,
                                 input: DictationAudioInput) -> DictationEngine? {
    guard #available(macOS 26.0, *) else { return nil }
    return DictationAnalyzerEngine(kind: kind, locale: locale, events: events, input: input)
}

/// SpeechTranscriber and DictationTranscriber's view of `locale` (macOS 26 and later; empty before that).
func probeDictationTranscribers(for locale: Locale) async -> DictationTranscriberSupport {
    guard #available(macOS 26.0, *) else { return DictationTranscriberSupport() }
    var support = DictationTranscriberSupport()
    support.speechTranscriberAvailable = SpeechTranscriber.isAvailable
    support.speechLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    support.dictationLocale = await DictationTranscriber.supportedLocale(equivalentTo: locale)
    return support
}

/// SpeechAnalyzer with SpeechTranscriber (or DictationTranscriber), on the Mac. The language's model is fetched once by
/// macOS and kept by it, not by this app. The microphone is an AVAudioEngine input tap converted to the analyzer's format.
/// Everything but the audio and Speech callbacks runs on the main thread; those hop to it before they touch state.
@available(macOS 26.0, *)
final class DictationAnalyzerEngine: DictationEngine, @unchecked Sendable {
    /// Stop waiting for the last words after this long.
    static let finalizeTimeout: TimeInterval = 5

    private let kind: DictationAnalyzerKind
    private let locale: Locale
    private let events: DictationEngineEvents
    private let mic: DictationAudioInput
    private var runTask: Task<Void, Never>?
    private var analyzer: SpeechAnalyzer?
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var listening = false
    private var closed = false
    private var stopRequested = false
    private var interruptRequested = false

    init(kind: DictationAnalyzerKind, locale: Locale, events: DictationEngineEvents, input: DictationAudioInput) {
        self.kind = kind
        self.locale = locale
        self.events = events
        self.mic = input
    }

    var level: Double { mic.level }

    func start() {
        runTask = Task { @MainActor [weak self] in await self?.run() }
    }

    func stop() {
        guard !closed, !stopRequested else { return }
        stopRequested = true
        winddown()
    }

    func cancel() {
        guard !closed else { return }
        closed = true
        mic.onInterrupt = nil
        mic.stop()
        continuation?.finish()
        continuation = nil
        runTask?.cancel()
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
    }

    // MARK: the run

    @MainActor private func run() async {
        switch kind {
        case .speech:
            // `.fastResults` on top of `.volatileResults`: measured in Page Studio with real-time audio from a file,
            // `.volatileResults` alone delivered nothing for the first ~4 s and then in bursts (each sentence
            // committed ~3 s after it ended), where DictationTranscriber's progressive preset and `.fastResults`
            // show the first words after ~1 s. It trades some accuracy for that.
            let module = SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                           reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
            await run(module) { String($0.text.characters) }
        case .dictation:
            let module = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
            await run(module) { String($0.text.characters) }
        }
    }

    @MainActor private func run<M: SpeechModule>(_ module: M, text: @escaping (M.Result) -> String) async {
        // 1. The language's model: here already, or fetched by macOS.
        switch await AssetInventory.status(forModules: [module]) {
        case .unsupported:
            return end(.cannotStart)
        case .supported, .downloading:
            do {
                if let install = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                    let progress = install.progress
                    events.downloading(progress.isIndeterminate ? nil : progress.fractionCompleted)
                    let observation = progress.observe(\.fractionCompleted, options: [.new]) { [weak self] p, _ in
                        let fraction: Double? = p.isIndeterminate ? nil : p.fractionCompleted
                        DispatchQueue.main.async {
                            guard let self, !self.closed, !self.listening else { return }
                            self.events.downloading(fraction)
                        }
                    }
                    defer { observation.invalidate() }
                    try await install.downloadAndInstall()
                }
            } catch {
                return end(closed ? nil : .cannotStart)
            }
        case .installed:
            break
        @unknown default:
            break
        }
        guard !closed else { return }

        // 2. The analyzer, and the format it wants.
        let analyzer = SpeechAnalyzer(modules: [module])
        self.analyzer = analyzer
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
            return end(.cannotStart)
        }
        do {
            try await analyzer.prepareToAnalyze(in: format)
        } catch {
            return end(closed ? nil : .cannotStart)
        }
        guard !closed else { return }

        // 3. Results first, so none are missed, then the input, then the microphone.
        let results = Task { @MainActor [weak self] in
            do {
                for try await result in module.results {
                    guard let self, !self.closed else { return }
                    let words = text(result)
                    if result.isFinal { self.events.commit(words) } else { self.events.volatile(words) }
                }
            } catch {
                guard let self, !self.closed else { return }
                // The analysis failed under us: keep what was heard.
                self.interruptRequested = true
            }
        }
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        self.continuation = continuation
        do {
            try await analyzer.start(inputSequence: stream)
            guard !closed else { return results.cancel() }
            let converter = DictationBufferConverter(to: format)
            mic.onInterrupt = { [weak self] in self?.interrupted() }
            try mic.start { buffer in
                if let converted = converter.convert(buffer) { continuation.yield(AnalyzerInput(buffer: converted)) }
            }
        } catch {
            results.cancel()
            await analyzer.cancelAndFinishNow()
            return end(closed ? nil : .interrupted)
        }
        listening = true
        events.listening()
        if stopRequested || interruptRequested { winddown() }

        // 4. Until the results end: after `stop()` (finalised), an interruption, or an error.
        await results.value
        guard !closed else { return }
        end(interruptRequested ? .interrupted : .finished)
    }

    // MARK: ending

    /// Closes the microphone, lets the analyzer finalise what it has heard, and gives up on it after a while.
    private func winddown() {
        mic.onInterrupt = nil
        mic.stop()
        continuation?.finish()
        guard let analyzer else {
            // Still setting up: nothing was heard.
            cancel()
            return end(.finished)
        }
        Task { @MainActor in
            try? await analyzer.finalizeAndFinishThroughEndOfInput()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalizeTimeout) { [weak self] in
            guard let self, !self.closed else { return }
            if let analyzer = self.analyzer { Task { await analyzer.cancelAndFinishNow() } }
        }
    }

    private func interrupted() {
        guard !closed, !stopRequested else { return }
        interruptRequested = true
        winddown()
    }

    /// `how` nil: the engine was cancelled meanwhile, so there is nothing to say.
    private func end(_ how: DictationEngineEnd?) {
        guard !closed else { return }
        closed = true
        mic.onInterrupt = nil
        mic.stop()
        continuation?.finish()
        continuation = nil
        // Finished already after a stop; after an error this lets go of the analyzer.
        if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
        analyzer = nil
        if let how { events.ended(how) }
    }
}

#else

enum DictationAnalyzerKind {
    case speech, dictation
}

func makeDictationAnalyzerEngine(kind: DictationAnalyzerKind, locale: Locale, events: DictationEngineEvents,
                                 input: DictationAudioInput) -> DictationEngine? { nil }

func probeDictationTranscribers(for locale: Locale) async -> DictationTranscriberSupport { DictationTranscriberSupport() }

#endif

// MARK: - SFSpeechRecognizer

// macOS before 26, or a Mac or language the new transcribers don't cover. On the Mac when
// `supportsOnDeviceRecognition`, otherwise Apple's speech service (`onDevice` is false then, and the line says so
// while it listens). A server request ends near a minute, so a new one starts at 55 s and the committed words carry
// over (they live in the page's draft).

/// Everything but the audio and Speech callbacks runs on the main thread; those hop to it before they touch state.
final class DictationRecognizerEngine: DictationEngine, @unchecked Sendable {
    /// Apple's server ends a request near a minute: start the next one before that.
    static let serverRolloverAfter: TimeInterval = 55
    /// Stop waiting for the last words after this long.
    static let finalizeTimeout: TimeInterval = 4

    private let locale: Locale
    private let onDevice: Bool
    private let events: DictationEngineEvents
    private let mic: DictationAudioInput
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    /// Appended to from the audio thread; every access is under `lock`.
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private let lock = NSLock()
    /// Which request's results count. Bumped for every new request, so a late result of an old one is ignored.
    private var token = 0
    private var requestStartedAt = Date()
    private var heardInRequest = false
    private var fastFailures = 0
    private var lastVolatile = ""
    private var closed = false
    private var stopRequested = false
    private var interruptRequested = false

    init(locale: Locale, onDevice: Bool, events: DictationEngineEvents, input: DictationAudioInput) {
        self.locale = locale
        self.onDevice = onDevice
        self.events = events
        self.mic = input
    }

    var level: Double { mic.level }

    func start() {
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            return end(.cannotStart)
        }
        self.recognizer = recognizer
        beginRequest()
        mic.onInterrupt = { [weak self] in self?.interrupted() }
        do {
            try mic.start { [weak self] buffer in self?.append(buffer) }
        } catch {
            teardown()
            return end(.interrupted)
        }
        events.listening()
    }

    func stop() {
        guard !closed, !stopRequested else { return }
        stopRequested = true
        mic.stop()
        finishAudio()
        scheduleFinalizeTimeout()
    }

    func cancel() {
        guard !closed else { return }
        closed = true
        teardown()
    }

    // MARK: requests

    private func beginRequest() {
        guard let recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        req.requiresOnDeviceRecognition = onDevice
        if #available(macOS 13.0, *) { req.addsPunctuation = true }
        token += 1
        let mine = token
        setRequest(req)
        requestStartedAt = Date()
        heardInRequest = false
        task = DictationRecognizerEngine.makeTask(recognizer: recognizer, request: req) { [weak self] text, final, failed in
            DispatchQueue.main.async { self?.received(token: mine, text: text, final: final, failed: failed) }
        }
        if !onDevice {
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.serverRolloverAfter) { [weak self] in
                guard let self, !self.closed, !self.stopRequested, self.token == mine else { return }
                self.rollover(commitVolatile: true)
            }
        }
    }

    /// Created off the main actor: the result handler runs on a Speech queue.
    private static func makeTask(recognizer: SFSpeechRecognizer, request: SFSpeechAudioBufferRecognitionRequest,
                                 handler: @escaping @Sendable (String?, Bool, Bool) -> Void) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { result, error in
            handler(result?.bestTranscription.formattedString, result?.isFinal ?? false, error != nil)
        }
    }

    private func setRequest(_ r: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock(); request = r; lock.unlock()
    }

    /// The audio thread. Under the lock, so an `append` can never run after the `endAudio` of the same request
    /// (that is an Objective-C exception, which Swift cannot catch).
    private func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        request?.append(buffer)
        lock.unlock()
    }

    private func finishAudio() {
        lock.lock()
        request?.endAudio()
        request = nil
        lock.unlock()
    }

    private func received(token mine: Int, text: String?, final: Bool, failed: Bool) {
        guard !closed, mine == token else { return }
        if let text, !text.isEmpty { heardInRequest = true }
        if let text {
            if final {
                lastVolatile = ""
                events.commit(text)
            } else {
                lastVolatile = text
                events.volatile(text)
            }
        }
        if final || failed { requestEnded(failed: failed && !final) }
    }

    /// The task finished: after a stop that is the end; otherwise the recognizer ended it (a pause, a server limit,
    /// "no speech") and the next request carries on.
    private func requestEnded(failed: Bool) {
        if stopRequested || interruptRequested {
            if !lastVolatile.isEmpty { events.commit(lastVolatile); lastVolatile = "" }
            return end(interruptRequested ? .interrupted : .finished)
        }
        let quick = Date().timeIntervalSince(requestStartedAt) < 1 && !heardInRequest
        fastFailures = quick ? fastFailures + 1 : 0
        // A recognizer that fails again and again at once will not run (Dictation off, say).
        if fastFailures >= 3 {
            teardown()
            return end(failed ? .refused : .interrupted)
        }
        rollover(commitVolatile: failed)
    }

    /// A new request on the same microphone. What is showing as volatile is kept as final words first, and the old
    /// request's late results are ignored. A fraction of a second of audio may be lost.
    private func rollover(commitVolatile: Bool) {
        if commitVolatile, !lastVolatile.isEmpty { events.commit(lastVolatile) }
        lastVolatile = ""
        let old = task
        finishAudio()
        old?.cancel()
        beginRequest()
    }

    // MARK: ending

    private func interrupted() {
        guard !closed, !stopRequested else { return }
        // The microphone is already closed. Finalise what was heard, then say so.
        interruptRequested = true
        finishAudio()
        scheduleFinalizeTimeout()
    }

    private func scheduleFinalizeTimeout() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalizeTimeout) { [weak self] in
            guard let self, !self.closed else { return }
            if !self.lastVolatile.isEmpty { self.events.commit(self.lastVolatile); self.lastVolatile = "" }
            self.teardown()
            self.end(self.interruptRequested ? .interrupted : .finished)
        }
    }

    private func end(_ how: DictationEngineEnd) {
        guard !closed else { return }
        closed = true
        teardown()
        events.ended(how)
    }

    private func teardown() {
        mic.onInterrupt = nil
        mic.stop()
        setRequest(nil)
        task?.cancel()
        task = nil
        recognizer = nil
    }
}

// MARK: - What this Mac can do

/// What the Mac's speech engines say about the language, gathered at the start of a session. The choice itself is
/// `DictationEngineChoice.pick` (pure); this only asks the questions.
struct DictationProbe {
    var osMajor = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
    var languageName = ""
    var speechTranscriberAvailable = false
    var speechLocale: Locale?
    var dictationLocale: Locale?
    var recognizerLocale: Locale?
    var recognizerAvailable = false
    var recognizerOnDevice = false

    var choice: DictationEngineChoice {
        DictationEngineChoice.pick(
            osMajor: osMajor,
            transcriberAvailable: speechTranscriberAvailable,
            transcriberSupportsLocale: speechLocale != nil,
            dictationSupportsLocale: dictationLocale != nil,
            sfSupportsLocale: recognizerLocale != nil,
            sfOnDevice: recognizerOnDevice,
            sfAvailable: recognizerAvailable,
            language: languageName)
    }

    /// An engine that could not start is not tried again. A recognizer that fails on the device is not swapped for
    /// Apple's server: that path is only for a Mac that has no on-device recognition.
    mutating func ruleOut(_ choice: DictationEngineChoice?) {
        switch choice {
        case .speechTranscriber?: speechLocale = nil
        case .dictationTranscriber?: dictationLocale = nil
        case .recognizerOnDevice?, .recognizerServer?: recognizerAvailable = false
        case .unavailable?, nil: break
        }
    }

    /// "English (United Kingdom)", in the language the person uses.
    static func displayName(for locale: Locale) -> String {
        Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
    }

    static func run(for locale: Locale) async -> DictationProbe {
        var probe = DictationProbe()
        let transcribers = await probeDictationTranscribers(for: locale)
        probe.speechTranscriberAvailable = transcribers.speechTranscriberAvailable
        probe.speechLocale = transcribers.speechLocale
        probe.dictationLocale = transcribers.dictationLocale
        let supported = SFSpeechRecognizer.supportedLocales()
        if let id = DictationLocale.nearest(to: locale.identifier, in: supported.map { $0.identifier }),
           let recognizer = SFSpeechRecognizer(locale: Locale(identifier: id)) {
            probe.recognizerLocale = recognizer.locale
            probe.recognizerAvailable = recognizer.isAvailable
            probe.recognizerOnDevice = recognizer.supportsOnDeviceRecognition
        }
        probe.languageName = displayName(for: transcribers.speechLocale ?? transcribers.dictationLocale
                                         ?? probe.recognizerLocale ?? locale)
        return probe
    }
}

/// Microphone and Speech Recognition. Both are asked for, whichever engine listens (the SDK does not say whether
/// SpeechAnalyzer needs the second). The completions run off the main thread, so they are made here, outside any actor.
enum DictationPermissions {
    /// The usage strings are in Info.plist. Only an app bundle needs them (a bare executable, such as `tauri dev`,
    /// asks on behalf of its terminal), and one without them is terminated by macOS when it asks.
    static var declared: Bool {
        guard Bundle.main.bundleURL.pathExtension == "app" else { return true }
        return Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") != nil
            && Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") != nil
    }

    static func microphone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { continuation.resume(returning: $0) }
            }
        default:
            return false
        }
    }

    static func speech() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
            }
        default:
            return false
        }
    }
}

/// Everything a session asks of the outside world, so a test can answer for it. `live` is the app.
struct DictationEnvironment {
    var declared: () -> Bool
    var microphone: () async -> Bool
    var speech: () async -> Bool
    var probe: (Locale) async -> DictationProbe
    var makeInput: () -> DictationAudioInput

    static var live: DictationEnvironment {
        DictationEnvironment(
            declared: { DictationPermissions.declared },
            microphone: { await DictationPermissions.microphone() },
            speech: { await DictationPermissions.speech() },
            probe: { await DictationProbe.run(for: $0) },
            makeInput: { DictationMicTap() })
    }
}

// MARK: - The events, as JSON

/// One event as a JSON object. Built with JSONSerialization, never by string interpolation: words carry quotes.
enum DictationEvent {
    static let preparing: [String: Any] = ["t": "preparing"]
    static let interrupted: [String: Any] = ["t": "interrupted"]
    static let ended: [String: Any] = ["t": "ended"]
    static let failed: [String: Any] = ["t": "failed"]

    static func downloading(_ fraction: Double?, language: String) -> [String: Any] {
        let clamped = fraction.flatMap { $0.isFinite ? min(max($0, 0), 1) : nil }
        let f: Any = clamped.map { $0 as Any } ?? NSNull()
        return ["t": "downloading", "f": f, "language": language]
    }

    /// `service` is "apple" when Apple's speech service listens, null on the Mac.
    static func listening(onDevice: Bool) -> [String: Any] {
        let service: Any = onDevice ? (NSNull() as Any) : ("apple" as Any)
        return ["t": "listening", "onDevice": onDevice, "service": service]
    }

    static func level(_ v: Double) -> [String: Any] {
        let clean = v.isFinite ? min(max(v, 0), 1) : 0
        return ["t": "level", "v": (clean * 100).rounded() / 100]
    }

    static func volatile(_ s: String) -> [String: Any] { ["t": "volatile", "s": s] }
    static func committed(_ s: String) -> [String: Any] { ["t": "committed", "s": s] }
    static func denied(_ what: String) -> [String: Any] { ["t": "denied", "what": what] }

    static func unavailable(_ why: DictationUnavailable, language: String) -> [String: Any] {
        switch why {
        case .language(let name): return ["t": "unavailable", "why": "language", "language": name]
        case .noRecognizer: return ["t": "unavailable", "why": "noRecognizer", "language": language]
        }
    }

    static func json(_ event: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event, options: [.withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return "{\"t\":\"failed\"}" }
        return text
    }
}

// MARK: - One session

/// One listening, from the page's click to its terminal event (the controller of Page Studio's DictationController,
/// without the box: the page owns the draft). Everything here runs on the main thread. Speech and AVFoundation are
/// touched only when a session starts, never at launch.
final class DictationSession {
    /// Stop waiting for the last words after this long (the engines have shorter limits of their own).
    static let finishTimeout: TimeInterval = 6

    private let env: DictationEnvironment
    private let send: (String) -> Void
    /// Set by the owner: called once, last, when the session will say nothing more.
    var onRelease: (() -> Void)?

    private var probe = DictationProbe()
    private var choice: DictationEngineChoice?
    private var engine: DictationEngine?
    private var languageName = ""
    private var listening = false
    /// `stop()` was called while listening: the microphone is closed, the last words are on their way.
    private var finishing = false
    /// A terminal event was sent, or the session was cancelled: nothing more is said.
    private var closed = false
    private var released = false
    private var finishTimer: DispatchWorkItem?
    private var levelTimer: Timer?
    private var lastLevel = 0.0

    init(env: DictationEnvironment, send: @escaping (String) -> Void) {
        self.env = env
        self.send = send
    }

    // MARK: what the page asks for

    func start() {
        guard !closed else { return }
        languageName = DictationProbe.displayName(for: Locale.current)
        emit(DictationEvent.preparing)
        Task { @MainActor [weak self] in await self?.prepare() }
    }

    /// Stops listening and keeps the words: the microphone closes now and the last words are finalised, then `ended`.
    /// A stop before the microphone opened (permissions, the language model) just ends the session.
    func stop() {
        guard !closed, !finishing else { return }
        guard listening else {
            return terminal(DictationEvent.ended)
        }
        finishing = true
        stopLevelTimer()
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.closed else { return }
            self.terminal(DictationEvent.ended)
        }
        finishTimer = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.finishTimeout, execute: timeout)
        engine?.stop()
    }

    /// Closes the microphone and forgets the session. Says nothing.
    func cancel() {
        guard !closed else { return }
        closed = true
        cleanup()
        engine?.cancel()
        engine = nil
        release()
    }

    // MARK: start

    @MainActor private func prepare() async {
        // An app bundle that lacks the usage strings is killed by macOS the moment it asks.
        guard env.declared() else {
            NSLog("Voice input: Info.plist has no microphone or speech usage string, so the mic stays off")
            return terminal(DictationEvent.unavailable(.noRecognizer, language: languageName))
        }
        let heard = await env.microphone()
        let allowed = heard ? await env.speech() : true
        guard !closed else { return }
        guard heard else { return terminal(DictationEvent.denied("microphone")) }
        guard allowed else { return terminal(DictationEvent.denied("speech")) }

        let probe = await env.probe(Locale.current)
        guard !closed else { return }
        self.probe = probe
        languageName = probe.languageName
        launch()
    }

    /// Starts the engine the probe picks. One that can't start (its model is unsupported, it won't download) is ruled
    /// out and the next one is tried; the order is `DictationEngineChoice.pick`'s.
    private func launch() {
        guard !closed else { return }
        let choice = probe.choice
        self.choice = choice
        let events = makeEvents(onDevice: choice.isOnDevice)
        let engine: DictationEngine?
        switch choice {
        case .unavailable(let why):
            return terminal(DictationEvent.unavailable(why, language: languageName))
        case .speechTranscriber:
            engine = probe.speechLocale.flatMap {
                makeDictationAnalyzerEngine(kind: .speech, locale: $0, events: events, input: env.makeInput())
            }
        case .dictationTranscriber:
            engine = probe.dictationLocale.flatMap {
                makeDictationAnalyzerEngine(kind: .dictation, locale: $0, events: events, input: env.makeInput())
            }
        case .recognizerOnDevice, .recognizerServer:
            engine = probe.recognizerLocale.map {
                DictationRecognizerEngine(locale: $0, onDevice: choice.isOnDevice, events: events, input: env.makeInput())
            }
        }
        guard let engine else {
            probe.ruleOut(choice)
            return launch()
        }
        // Set before `start()`: an engine that can't start says so at once, and the next one replaces it.
        self.engine = engine
        engine.start()
    }

    private func makeEvents(onDevice: Bool) -> DictationEngineEvents {
        DictationEngineEvents(
            downloading: { [weak self] fraction in
                guard let self, !self.closed, !self.listening else { return }
                self.emit(DictationEvent.downloading(fraction, language: self.languageName))
            },
            listening: { [weak self] in
                guard let self, !self.closed, !self.listening else { return }
                self.listening = true
                self.emit(DictationEvent.listening(onDevice: onDevice))
                self.startLevelTimer()
            },
            volatile: { [weak self] text in
                guard let self, !self.closed else { return }
                self.emit(DictationEvent.volatile(text))
            },
            commit: { [weak self] text in
                guard let self, !self.closed else { return }
                self.emit(DictationEvent.committed(text))
            },
            ended: { [weak self] how in self?.engineEnded(how) })
    }

    // MARK: ending

    /// How the engine ended, as the one terminal event.
    private func engineEnded(_ how: DictationEngineEnd) {
        guard !closed else { return }
        switch how {
        case .finished:
            terminal(DictationEvent.ended)
        case .interrupted:
            // Stopped by the person meanwhile: that is just the end.
            terminal(finishing ? DictationEvent.ended : DictationEvent.interrupted)
        case .refused:
            terminal(DictationEvent.unavailable(.noRecognizer, language: languageName))
        case .cannotStart:
            if listening {
                terminal(finishing ? DictationEvent.ended : DictationEvent.interrupted)
            } else {
                engine = nil
                probe.ruleOut(choice)
                launch()
            }
        }
    }

    /// The last thing the session says. Closes the microphone and lets go of the engine.
    private func terminal(_ event: [String: Any]) {
        guard !closed else { return }
        closed = true
        cleanup()
        let old = engine
        engine = nil
        old?.cancel()
        emitAlways(event)
        release()
    }

    private func cleanup() {
        finishTimer?.cancel()
        finishTimer = nil
        stopLevelTimer()
    }

    private func release() {
        guard !released else { return }
        released = true
        onRelease?()
    }

    private func emit(_ event: [String: Any]) {
        guard !closed else { return }
        emitAlways(event)
    }

    private func emitAlways(_ event: [String: Any]) {
        send(DictationEvent.json(event))
    }

    // MARK: level

    private func startLevelTimer() {
        stopLevelTimer()
        let timer = Timer(timeInterval: 1.0 / 15, repeats: true) { [weak self] _ in self?.tick() }
        timer.tolerance = 0.02
        RunLoop.main.add(timer, forMode: .common)
        levelTimer = timer
    }

    private func stopLevelTimer() {
        levelTimer?.invalidate()
        levelTimer = nil
    }

    /// About 15 times a second while listening: the voice level, when it moved.
    private func tick() {
        guard listening, !finishing, !closed, let engine else { return stopLevelTimer() }
        let level = engine.level
        if abs(level - lastLevel) >= 0.02 {
            lastLevel = level
            emit(DictationEvent.level(level))
        }
    }
}

// MARK: - The C ABI

/// The one session there is, touched on the main queue only.
enum DictationHost {
    static var current: DictationSession?

    static func start(env: DictationEnvironment, send: @escaping (String) -> Void, release: @escaping () -> Void) {
        current?.cancel()
        let session = DictationSession(env: env, send: send)
        session.onRelease = { [unowned session] in
            release()
            if current === session { current = nil }
        }
        current = session
        session.start()
    }
}

public typealias PDCallback = @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void

@_cdecl("pd_start")
public func pd_start(_ cb: PDCallback?, _ ctx: UnsafeMutableRawPointer?) {
    guard let cb else { return }
    DispatchQueue.main.async {
        DictationHost.start(
            env: .live,
            send: { json in json.withCString { cb($0, ctx) } },
            release: { cb(nil, ctx) })
    }
}

@_cdecl("pd_stop")
public func pd_stop() {
    DispatchQueue.main.async { DictationHost.current?.stop() }
}

@_cdecl("pd_cancel")
public func pd_cancel() {
    DispatchQueue.main.async { DictationHost.current?.cancel() }
}
