import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

public final class ExpoDurableFileModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoDurableFile")

    AsyncFunction("persistCapture") {
      (captureId: String, sourceUri: String, debugFailurePoint: String) -> [String: Any] in
      self.persistCapture(
        captureId: captureId,
        sourceUri: sourceUri,
        debugFailurePoint: debugFailurePoint
      )
    }

    AsyncFunction("scanCaptureResidues") { () -> [String: Any] in
      try self.scanCaptureResidues()
    }

    AsyncFunction("getThermalState") { () -> String in
      switch ProcessInfo.processInfo.thermalState {
      case .nominal: return "nominal"
      case .fair: return "fair"
      case .serious: return "serious"
      case .critical: return "critical"
      @unknown default: return "unknown"
      }
    }

    AsyncFunction("quarantineCaptureResidue") {
      (captureId: String, residue: String, reason: String) -> Void in
      try self.quarantineCaptureResidue(
        captureId: captureId,
        residue: residue,
        reason: reason
      )
    }

    AsyncFunction("terminateProcessForDurabilityOracle") { () -> Void in
      #if DEBUG
      self.terminateForDurabilityOracle()
      #else
      throw DurableFileFailure(
        code: "DEBUG_FAILURE_DISABLED",
        message: "Failure injection is disabled outside development builds.",
        retryable: false
      )
      #endif
    }
  }

  private let fileManager = FileManager.default
  private let captureIdPattern = try! NSRegularExpression(
    pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
  )
  private let supportedFailurePoints: Set<String> = [
    "none",
    "terminate_after_copy",
    "terminate_after_hash",
    "return_after_partial_sync",
    "terminate_after_partial_sync",
    "return_after_atomic_rename",
    "terminate_after_atomic_rename",
  ]

  private func persistCapture(
    captureId: String,
    sourceUri: String,
    debugFailurePoint: String
  ) -> [String: Any] {
    var stage = "validation"
    var partialURL: URL?
    var finalURL: URL?
    var published = false
    var preservePartialForDebug = false

    do {
      try validateCaptureId(captureId)
      try validateFailurePoint(debugFailurePoint)
      let sourceURL = try validatedSourceURL(sourceUri)

      stage = "prepare_destination"
      let rootURL = try durableRootURL()
      guard !isDescendant(sourceURL, of: rootURL) else {
        throw DurableFileFailure(
          code: "SOURCE_INSIDE_DURABLE_ROOT",
          message: "The source file must be outside the immutable capture directory.",
          retryable: false
        )
      }

      let candidateFinalURL = rootURL.appendingPathComponent(
        "\(captureId).capture",
        isDirectory: false
      )
      finalURL = candidateFinalURL
      guard !fileManager.fileExists(atPath: candidateFinalURL.path) else {
        throw DurableFileFailure(
          code: "FINAL_ALREADY_EXISTS",
          message: "A durable file already exists for this capture identity.",
          retryable: false
        )
      }

      let candidatePartialURL = rootURL.appendingPathComponent(
        ".\(captureId).\(UUID().uuidString).partial",
        isDirectory: false
      )
      partialURL = candidatePartialURL
      guard fileManager.createFile(
        atPath: candidatePartialURL.path,
        contents: nil,
        attributes: [
          .posixPermissions: 0o600,
          .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ]
      ) else {
        throw DurableFileFailure(
          code: "PARTIAL_CREATE_FAILED",
          message: "The durable partial file could not be created.",
          retryable: true
        )
      }

      stage = "copy"
      let copy = try copyHashAndSynchronize(
        from: sourceURL,
        to: candidatePartialURL,
        debugFailurePoint: debugFailurePoint,
        stage: &stage
      )

      stage = "partial_sync"
      if debugFailurePoint == "return_after_partial_sync" {
        preservePartialForDebug = true
        throw DurableFileFailure(
          code: "DEBUG_FAILURE_INJECTED",
          message: "Development failure injected after durable partial synchronisation.",
          retryable: true
        )
      }
      if debugFailurePoint == "terminate_after_partial_sync" {
        terminateForDurabilityOracle()
      }

      stage = "hash"
      if debugFailurePoint == "terminate_after_hash" {
        terminateForDurabilityOracle()
      }

      stage = "make_immutable"
      guard Darwin.chmod(candidatePartialURL.path, S_IRUSR) == 0 else {
        throw DurableFileFailure(
          code: "IMMUTABILITY_FAILED",
          message: "The durable partial file could not be made read-only.",
          retryable: true
        )
      }
      try synchronizeReadOnlyFile(candidatePartialURL)

      stage = "atomic_rename"
      try exclusiveAtomicRename(from: candidatePartialURL, to: candidateFinalURL)
      published = true
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: candidateFinalURL.path
      )

      if debugFailurePoint == "return_after_atomic_rename" {
        throw DurableFileFailure(
          code: "DEBUG_FAILURE_INJECTED",
          message: "Development failure injected after atomic publication.",
          retryable: true
        )
      }
      if debugFailurePoint == "terminate_after_atomic_rename" {
        terminateForDurabilityOracle()
      }

      stage = "directory_sync"
      let directorySync = try synchronizeDirectory(rootURL)

      stage = "complete"
      return [
        "ok": true,
        "storageBoundaryVersion": 1,
        "captureId": captureId,
        "fileUri": candidateFinalURL.absoluteString,
        "sha256": copy.sha256,
        "byteLength": copy.byteLength,
        "immutable": true,
        "directorySync": directorySync,
      ]
    } catch {
      if !published && !preservePartialForDebug, let partialURL {
        try? fileManager.removeItem(at: partialURL)
      }

      let failure = (error as? DurableFileFailure) ?? DurableFileFailure(
        code: "IO_FAILURE",
        message: "The native durable-file operation failed.",
        retryable: true
      )
      let artifactState: String
      if published {
        artifactState = "final_may_exist"
      } else if preservePartialForDebug {
        artifactState = "partial_preserved_debug"
      } else {
        artifactState = "none"
      }

      var result: [String: Any] = [
        "ok": false,
        "storageBoundaryVersion": 1,
        "captureId": captureId,
        "error": [
          "code": failure.code,
          "stage": stage,
          "message": failure.safeMessage,
          "retryable": failure.retryable,
          "artifactState": artifactState,
        ],
      ]

      #if DEBUG
      if artifactState == "partial_preserved_debug", let partialURL {
        result["debugArtifactUri"] = partialURL.absoluteString
      } else if artifactState == "final_may_exist", let finalURL {
        result["debugArtifactUri"] = finalURL.absoluteString
      }
      #endif

      return result
    }
  }

  private func validateCaptureId(_ captureId: String) throws {
    let range = NSRange(captureId.startIndex..<captureId.endIndex, in: captureId)
    guard captureIdPattern.firstMatch(in: captureId, range: range)?.range == range else {
      throw DurableFileFailure(
        code: "INVALID_CAPTURE_ID",
        message: "Capture identity must be 1-128 ASCII letters, digits, underscores or hyphens.",
        retryable: false
      )
    }
  }

  private func validateFailurePoint(_ failurePoint: String) throws {
    guard supportedFailurePoints.contains(failurePoint) else {
      throw DurableFileFailure(
        code: "DEBUG_FAILURE_INJECTED",
        message: "The requested development failure point is not recognised.",
        retryable: false
      )
    }
    #if !DEBUG
    guard failurePoint == "none" else {
      throw DurableFileFailure(
        code: "DEBUG_FAILURE_DISABLED",
        message: "Failure injection is disabled outside development builds.",
        retryable: false
      )
    }
    #endif
  }

  private func validatedSourceURL(_ sourceUri: String) throws -> URL {
    guard
      let sourceURL = URL(string: sourceUri),
      sourceURL.isFileURL,
      sourceURL.query == nil,
      sourceURL.fragment == nil,
      sourceURL.host == nil || sourceURL.host == "" || sourceURL.host == "localhost"
    else {
      throw DurableFileFailure(
        code: "INVALID_SOURCE_URI",
        message: "Source URI must be a local file URI without query or fragment data.",
        retryable: false
      )
    }

    if let components = URLComponents(string: sourceUri) {
      let hasTraversal = components.percentEncodedPath
        .split(separator: "/")
        .contains { segment in
          String(segment).removingPercentEncoding == ".."
        }
      guard !hasTraversal else {
        throw DurableFileFailure(
          code: "PATH_TRAVERSAL",
          message: "Parent path segments are not accepted in source URIs.",
          retryable: false
        )
      }
    }

    let presentedURL = sourceURL.standardizedFileURL
    let presentedValues = try presentedURL.resourceValues(
      forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .isReadableKey]
    )
    guard presentedValues.isSymbolicLink != true, presentedValues.isRegularFile == true else {
      throw DurableFileFailure(
        code: "SOURCE_NOT_REGULAR_FILE",
        message: "Source URI must identify a regular file and not a symbolic link.",
        retryable: false
      )
    }
    guard presentedValues.isReadable == true else {
      throw DurableFileFailure(
        code: "SOURCE_UNREADABLE",
        message: "The source file is not readable by the application.",
        retryable: true
      )
    }
    return presentedURL.resolvingSymlinksInPath()
  }

  private func durableRootURL() throws -> URL {
    guard let applicationSupport = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      throw DurableFileFailure(
        code: "DESTINATION_UNAVAILABLE",
        message: "Application Support storage is unavailable.",
        retryable: true
      )
    }
    let rootURL = applicationSupport
      .appendingPathComponent("InspectionHub", isDirectory: true)
      .appendingPathComponent("Captures", isDirectory: true)
      .standardizedFileURL
    do {
      try fileManager.createDirectory(
        at: rootURL,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
      try fileManager.setAttributes(
        [
          .posixPermissions: 0o700,
          .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ],
        ofItemAtPath: rootURL.path
      )
      var resourceValues = URLResourceValues()
      resourceValues.isExcludedFromBackup = true
      var mutableRootURL = rootURL
      try mutableRootURL.setResourceValues(resourceValues)
    } catch {
      throw DurableFileFailure(
        code: "DESTINATION_UNAVAILABLE",
        message: "The private durable capture directory could not be prepared.",
        retryable: true
      )
    }
    return rootURL
  }

  private func isDescendant(_ candidate: URL, of root: URL) -> Bool {
    let candidatePath = candidate.standardizedFileURL.path
    let rootPath = root.standardizedFileURL.path
    return candidatePath == rootPath || candidatePath.hasPrefix(rootPath + "/")
  }

  private func copyHashAndSynchronize(
    from sourceURL: URL,
    to partialURL: URL,
    debugFailurePoint: String,
    stage: inout String
  ) throws -> (sha256: String, byteLength: Int64) {
    let sourceHandle: FileHandle
    let destinationHandle: FileHandle
    do {
      sourceHandle = try FileHandle(forReadingFrom: sourceURL)
      destinationHandle = try FileHandle(forWritingTo: partialURL)
    } catch {
      throw DurableFileFailure(
        code: "IO_FAILURE",
        message: "Source or destination file could not be opened.",
        retryable: true
      )
    }
    defer {
      try? sourceHandle.close()
      try? destinationHandle.close()
    }

    var hasher = SHA256()
    var byteLength: Int64 = 0
    do {
      while let data = try sourceHandle.read(upToCount: 1_048_576), !data.isEmpty {
        try destinationHandle.write(contentsOf: data)
        hasher.update(data: data)
        byteLength += Int64(data.count)
      }
      if debugFailurePoint == "terminate_after_copy" {
        terminateForDurabilityOracle()
      }
      stage = "partial_sync"
      try destinationHandle.synchronize()
      guard Darwin.fsync(destinationHandle.fileDescriptor) == 0 else {
        throw DurableFileFailure(
          code: "PARTIAL_SYNC_FAILED",
          message: "The durable partial file could not be synchronised.",
          retryable: true
        )
      }
    } catch let failure as DurableFileFailure {
      throw failure
    } catch {
      let code = stage == "partial_sync" ? "PARTIAL_SYNC_FAILED" : "IO_FAILURE"
      let message = stage == "partial_sync"
        ? "The durable partial file could not be synchronised."
        : "The source file could not be copied into durable storage."
      throw DurableFileFailure(code: code, message: message, retryable: true)
    }

    stage = "hash"
    let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    return (digest, byteLength)
  }

  private func synchronizeReadOnlyFile(_ fileURL: URL) throws {
    let descriptor = Darwin.open(fileURL.path, O_RDONLY)
    guard descriptor >= 0 else {
      throw DurableFileFailure(
        code: "IMMUTABILITY_FAILED",
        message: "The read-only durable file could not be reopened.",
        retryable: true
      )
    }
    defer { Darwin.close(descriptor) }
    guard Darwin.fsync(descriptor) == 0 else {
      throw DurableFileFailure(
        code: "IMMUTABILITY_FAILED",
        message: "The read-only durable file metadata could not be synchronised.",
        retryable: true
      )
    }
  }

  private func exclusiveAtomicRename(from sourceURL: URL, to destinationURL: URL) throws {
    let result = sourceURL.path.withCString { sourcePath in
      destinationURL.path.withCString { destinationPath in
        Darwin.renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL))
      }
    }
    guard result == 0 else {
      if errno == EEXIST {
        throw DurableFileFailure(
          code: "FINAL_ALREADY_EXISTS",
          message: "A durable file already exists for this capture identity.",
          retryable: false
        )
      }
      throw DurableFileFailure(
        code: "ATOMIC_RENAME_UNAVAILABLE",
        message: "Exclusive same-filesystem atomic publication failed.",
        retryable: true
      )
    }
  }

  private func synchronizeDirectory(_ directoryURL: URL) throws -> String {
    let descriptor = Darwin.open(directoryURL.path, O_RDONLY)
    guard descriptor >= 0 else {
      throw DurableFileFailure(
        code: "DIRECTORY_SYNC_FAILED",
        message: "The durable capture directory could not be opened for synchronisation.",
        retryable: true
      )
    }
    defer { Darwin.close(descriptor) }
    if Darwin.fsync(descriptor) == 0 {
      return "synced"
    }
    throw DurableFileFailure(
      code: "DIRECTORY_SYNC_FAILED",
      message: "The durable capture directory could not be synchronised.",
      retryable: true
    )
  }

  private func scanCaptureResidues() throws -> [String: Any] {
    let rootURL = try durableRootURL()
    let urls = try fileManager.contentsOfDirectory(
      at: rootURL,
      includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
      options: []
    )
    var finals: [[String: Any]] = []
    var partials: [[String: Any]] = []

    for fileURL in urls {
      let name = fileURL.lastPathComponent
      if name.hasSuffix(".capture") {
        let captureId = String(name.dropLast(".capture".count))
        do {
          try validateCaptureId(captureId)
          let attributes = try fileManager.attributesOfItem(atPath: fileURL.path)
          let byteLength = (attributes[.size] as? NSNumber)?.int64Value ?? 0
          let sha256 = try hashFile(fileURL)
          let integrity = byteLength > 0 ? "valid" : "corrupt"
          finals.append([
            "artifact": [
              "captureId": captureId,
              "fileUri": fileURL.absoluteString,
              "sha256": sha256,
              "byteLength": byteLength,
              "immutable": true,
              "directorySync": "synced",
            ],
            "integrity": integrity,
          ])
        } catch {
          // A malformed filename cannot be associated with an existing ledger identity.
          continue
        }
      } else if let captureId = captureIdFromPartialName(name) {
        partials.append([
          "captureId": captureId,
          "fileUri": fileURL.absoluteString,
        ])
      }
    }
    _ = try synchronizeDirectory(rootURL)
    return [
      "storageBoundaryVersion": 1,
      "finals": finals,
      "partials": partials,
    ]
  }

  private func quarantineCaptureResidue(
    captureId: String,
    residue: String,
    reason: String
  ) throws {
    try validateCaptureId(captureId)
    guard residue == "final" || residue == "partial" else {
      throw DurableFileFailure(
        code: "INVALID_SOURCE_URI",
        message: "Quarantine residue must be final or partial.",
        retryable: false
      )
    }
    let rootURL = try durableRootURL()
    let quarantineURL = rootURL.appendingPathComponent("Quarantine", isDirectory: true)
    try fileManager.createDirectory(
      at: quarantineURL,
      withIntermediateDirectories: true,
      attributes: [
        .posixPermissions: 0o700,
        .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
      ]
    )
    let candidates = try fileManager.contentsOfDirectory(
      at: rootURL,
      includingPropertiesForKeys: nil,
      options: []
    ).filter { url in
      if residue == "final" {
        return url.lastPathComponent == "\(captureId).capture"
      }
      return captureIdFromPartialName(url.lastPathComponent) == captureId
    }
    for sourceURL in candidates {
      let safeReason = reason
        .replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        .prefix(48)
      let destinationURL = quarantineURL.appendingPathComponent(
        "\(captureId).\(safeReason).\(UUID().uuidString).quarantined"
      )
      try fileManager.moveItem(at: sourceURL, to: destinationURL)
      try fileManager.setAttributes(
        [
          .posixPermissions: 0o400,
          .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        ],
        ofItemAtPath: destinationURL.path
      )
    }
    _ = try synchronizeDirectory(rootURL)
    _ = try synchronizeDirectory(quarantineURL)
  }

  private func captureIdFromPartialName(_ name: String) -> String? {
    guard name.hasPrefix("."), name.hasSuffix(".partial") else { return nil }
    let withoutPrefix = String(name.dropFirst())
    guard let separator = withoutPrefix.firstIndex(of: ".") else { return nil }
    let captureId = String(withoutPrefix[..<separator])
    do {
      try validateCaptureId(captureId)
      return captureId
    } catch {
      return nil
    }
  }

  private func hashFile(_ fileURL: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
      hasher.update(data: data)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private func terminateForDurabilityOracle() -> Never {
    #if DEBUG
    Darwin.kill(Darwin.getpid(), SIGKILL)
    fatalError("SIGKILL failure injection did not terminate the development process")
    #else
    fatalError("Failure injection is unavailable outside development builds")
    #endif
  }
}

private struct DurableFileFailure: Error {
  let code: String
  let safeMessage: String
  let retryable: Bool

  init(code: String, message: String, retryable: Bool) {
    self.code = code
    self.safeMessage = message
    self.retryable = retryable
  }
}
