package expo.modules.durablefile

import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Process
import android.os.PowerManager
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID

class ExpoDurableFileModule : Module() {
  private val publishLock = Any()
  private val captureIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
  private val supportedFailurePoints = setOf(
    "none",
    "terminate_after_copy",
    "terminate_after_hash",
    "return_after_partial_sync",
    "terminate_after_partial_sync",
    "return_after_atomic_rename",
    "terminate_after_atomic_rename",
  )

  override fun definition() = ModuleDefinition {
    Name("ExpoDurableFile")

    AsyncFunction("persistCapture") { captureId: String, sourceUri: String, debugFailurePoint: String ->
      persistCapture(captureId, sourceUri, debugFailurePoint)
    }

    AsyncFunction("scanCaptureResidues") {
      scanCaptureResidues()
    }

    AsyncFunction("getThermalState") {
      observedThermalState()
    }

    AsyncFunction("quarantineCaptureResidue") { captureId: String, residue: String, reason: String ->
      quarantineCaptureResidue(captureId, residue, reason)
    }

    AsyncFunction("terminateProcessForDurabilityOracle") {
      val context = appContext.reactContext ?: throw DurableFileFailure(
        "DESTINATION_UNAVAILABLE",
        "Application storage context is unavailable.",
        true,
      )
      validateFailurePoint(context, "terminate_after_copy")
      terminateForDurabilityOracle()
    }
  }

  private fun observedThermalState(): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unknown"
    val context = appContext.reactContext ?: return "unknown"
    val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return "unknown"
    return when (power.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE -> "nominal"
      PowerManager.THERMAL_STATUS_LIGHT -> "fair"
      PowerManager.THERMAL_STATUS_MODERATE,
      PowerManager.THERMAL_STATUS_SEVERE -> "serious"
      PowerManager.THERMAL_STATUS_CRITICAL,
      PowerManager.THERMAL_STATUS_EMERGENCY,
      PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
      else -> "unknown"
    }
  }

  private fun persistCapture(
    captureId: String,
    sourceUri: String,
    debugFailurePoint: String,
  ): Map<String, Any?> {
    var stage = "validation"
    var partialFile: File? = null
    var finalFile: File? = null
    var published = false
    var preservePartialForDebug = false

    try {
      validateCaptureId(captureId)
      val context = appContext.reactContext ?: throw DurableFileFailure(
        "DESTINATION_UNAVAILABLE",
        "Application storage context is unavailable.",
        true,
      )
      validateFailurePoint(context, debugFailurePoint)
      val sourceFile = validatedSourceFile(sourceUri)

      stage = "prepare_destination"
      val root = durableRoot(context)
      if (sourceFile.toPath().startsWith(root.toPath())) {
        throw DurableFileFailure(
          "SOURCE_INSIDE_DURABLE_ROOT",
          "The source file must be outside the immutable capture directory.",
          false,
        )
      }

      val candidateFinal = File(root, "$captureId.capture")
      finalFile = candidateFinal
      synchronized(publishLock) {
        if (candidateFinal.exists()) {
          throw DurableFileFailure(
            "FINAL_ALREADY_EXISTS",
            "A durable file already exists for this capture identity.",
            false,
          )
        }
      }

      val candidatePartial = File(root, ".$captureId.${UUID.randomUUID()}.partial")
      partialFile = candidatePartial
      if (!candidatePartial.createNewFile()) {
        throw DurableFileFailure(
          "PARTIAL_CREATE_FAILED",
          "The durable partial file could not be created.",
          true,
        )
      }
      Os.chmod(candidatePartial.absolutePath, 384) // 0600

      stage = "copy"
      val copy = copyHashAndSynchronize(
        sourceFile,
        candidatePartial,
        debugFailurePoint,
      ) { currentStage ->
        stage = currentStage
      }

      stage = "partial_sync"
      if (debugFailurePoint == "return_after_partial_sync") {
        preservePartialForDebug = true
        throw DurableFileFailure(
          "DEBUG_FAILURE_INJECTED",
          "Development failure injected after durable partial synchronisation.",
          true,
        )
      }
      if (debugFailurePoint == "terminate_after_partial_sync") {
        terminateForDurabilityOracle()
      }

      stage = "hash"
      if (debugFailurePoint == "terminate_after_hash") {
        terminateForDurabilityOracle()
      }

      stage = "make_immutable"
      try {
        Os.chmod(candidatePartial.absolutePath, 256) // 0400
        FileInputStream(candidatePartial).use { input ->
          input.fd.sync()
          Os.fsync(input.fd)
        }
      } catch (_: Exception) {
        throw DurableFileFailure(
          "IMMUTABILITY_FAILED",
          "The durable partial file could not be made read-only and synchronised.",
          true,
        )
      }

      stage = "atomic_rename"
      synchronized(publishLock) {
        if (candidateFinal.exists()) {
          throw DurableFileFailure(
            "FINAL_ALREADY_EXISTS",
            "A durable file already exists for this capture identity.",
            false,
          )
        }
        try {
          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            throw DurableFileFailure(
              "ATOMIC_RENAME_UNAVAILABLE",
              "Exclusive atomic publication requires Android API 26 or newer.",
              false,
            )
          }
          atomicMove(candidatePartial, candidateFinal)
        } catch (_: FileAlreadyExistsException) {
          throw DurableFileFailure(
            "FINAL_ALREADY_EXISTS",
            "A durable file already exists for this capture identity.",
            false,
          )
        } catch (_: AtomicMoveNotSupportedException) {
          throw DurableFileFailure(
            "ATOMIC_RENAME_UNAVAILABLE",
            "Same-filesystem atomic publication is unavailable.",
            true,
          )
        }
      }
      published = true

      if (debugFailurePoint == "return_after_atomic_rename") {
        throw DurableFileFailure(
          "DEBUG_FAILURE_INJECTED",
          "Development failure injected after atomic publication.",
          true,
        )
      }
      if (debugFailurePoint == "terminate_after_atomic_rename") {
        terminateForDurabilityOracle()
      }

      stage = "directory_sync"
      val directorySync = synchronizeDirectory(root)

      stage = "complete"
      return mapOf(
        "ok" to true,
        "storageBoundaryVersion" to 1,
        "captureId" to captureId,
        "fileUri" to Uri.fromFile(candidateFinal).toString(),
        "sha256" to copy.sha256,
        "byteLength" to copy.byteLength,
        "immutable" to true,
        "directorySync" to directorySync,
      )
    } catch (error: Exception) {
      if (!published && !preservePartialForDebug) {
        partialFile?.delete()
      }

      val failure = error as? DurableFileFailure ?: DurableFileFailure(
        "IO_FAILURE",
        "The native durable-file operation failed.",
        true,
      )
      val artifactState = when {
        published -> "final_may_exist"
        preservePartialForDebug -> "partial_preserved_debug"
        else -> "none"
      }
      val result = mutableMapOf<String, Any?>(
        "ok" to false,
        "storageBoundaryVersion" to 1,
        "captureId" to captureId,
        "error" to mapOf(
          "code" to failure.code,
          "stage" to stage,
          "message" to failure.safeMessage,
          "retryable" to failure.retryable,
          "artifactState" to artifactState,
        ),
      )
      val context = appContext.reactContext
      if (context != null && isDebuggable(context)) {
        when (artifactState) {
          "partial_preserved_debug" -> partialFile?.let {
            result["debugArtifactUri"] = Uri.fromFile(it).toString()
          }
          "final_may_exist" -> finalFile?.let {
            result["debugArtifactUri"] = Uri.fromFile(it).toString()
          }
        }
      }
      return result
    }
  }

  private fun validateCaptureId(captureId: String) {
    if (!captureIdPattern.matches(captureId)) {
      throw DurableFileFailure(
        "INVALID_CAPTURE_ID",
        "Capture identity must be 1-128 ASCII letters, digits, underscores or hyphens.",
        false,
      )
    }
  }

  private fun validateFailurePoint(context: Context, failurePoint: String) {
    if (!supportedFailurePoints.contains(failurePoint)) {
      throw DurableFileFailure(
        "DEBUG_FAILURE_INJECTED",
        "The requested development failure point is not recognised.",
        false,
      )
    }
    if (failurePoint != "none" && !isDebuggable(context)) {
      throw DurableFileFailure(
        "DEBUG_FAILURE_DISABLED",
        "Failure injection is disabled outside development builds.",
        false,
      )
    }
  }

  private fun isDebuggable(context: Context): Boolean =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  private fun validatedSourceFile(sourceUri: String): File {
    val uri = try {
      Uri.parse(sourceUri)
    } catch (_: Exception) {
      null
    }
    if (
      uri == null || uri.scheme != "file" || uri.path.isNullOrBlank() ||
      uri.query != null || uri.fragment != null ||
      !(uri.host.isNullOrBlank() || uri.host == "localhost")
    ) {
      throw DurableFileFailure(
        "INVALID_SOURCE_URI",
        "Source URI must be a local file URI without query or fragment data.",
        false,
      )
    }
    if (uri.pathSegments.any { it == ".." }) {
      throw DurableFileFailure(
        "PATH_TRAVERSAL",
        "Parent path segments are not accepted in source URIs.",
        false,
      )
    }

    val presentedFile = File(uri.path!!).absoluteFile
    val sourceFile = try {
      presentedFile.canonicalFile
    } catch (_: Exception) {
      throw DurableFileFailure(
        "SOURCE_NOT_REGULAR_FILE",
        "Source URI could not be resolved to a regular file.",
        false,
      )
    }
    if (presentedFile.path != sourceFile.path) {
      throw DurableFileFailure(
        "SOURCE_NOT_REGULAR_FILE",
        "Source URI must identify a regular file without symbolic-link path components.",
        false,
      )
    }
    if (!sourceFile.isFile) {
      throw DurableFileFailure(
        "SOURCE_NOT_REGULAR_FILE",
        "Source URI must identify a regular file and not a symbolic link.",
        false,
      )
    }
    if (!sourceFile.canRead()) {
      throw DurableFileFailure(
        "SOURCE_UNREADABLE",
        "The source file is not readable by the application.",
        true,
      )
    }
    return sourceFile
  }

  private fun durableRoot(context: Context): File {
    val root = File(context.noBackupFilesDir, "inspectionhub/captures")
    if ((!root.exists() && !root.mkdirs()) || !root.isDirectory) {
      throw DurableFileFailure(
        "DESTINATION_UNAVAILABLE",
        "The private durable capture directory could not be prepared.",
        true,
      )
    }
    Os.chmod(root.absolutePath, 448) // 0700
    return root.canonicalFile
  }

  private fun copyHashAndSynchronize(
    source: File,
    partial: File,
    debugFailurePoint: String,
    updateStage: (String) -> Unit,
  ): CopyResult {
    val digest = MessageDigest.getInstance("SHA-256")
    var byteLength = 0L
    var synchronizing = false
    try {
      FileInputStream(source).use { input ->
        FileOutputStream(partial, false).use { output ->
          val buffer = ByteArray(1_048_576)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            output.write(buffer, 0, count)
            digest.update(buffer, 0, count)
            byteLength += count.toLong()
          }
          if (debugFailurePoint == "terminate_after_copy") {
            terminateForDurabilityOracle()
          }
          updateStage("partial_sync")
          synchronizing = true
          output.flush()
          output.fd.sync()
          Os.fsync(output.fd)
        }
      }
    } catch (error: DurableFileFailure) {
      throw error
    } catch (_: Exception) {
      throw DurableFileFailure(
        if (synchronizing) "PARTIAL_SYNC_FAILED" else "IO_FAILURE",
        if (synchronizing)
          "The durable partial file could not be synchronised."
        else
          "The source file could not be copied into durable storage.",
        true,
      )
    }
    updateStage("hash")
    return CopyResult(
      digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) },
      byteLength,
    )
  }

  private fun synchronizeDirectory(directory: File): String {
    val descriptor = try {
      Os.open(
        directory.absolutePath,
        OsConstants.O_RDONLY or OsConstants.O_DIRECTORY,
        0,
      )
    } catch (_: ErrnoException) {
      throw DurableFileFailure(
        "DIRECTORY_SYNC_FAILED",
        "The durable capture directory could not be opened for synchronisation.",
        true,
      )
    }
    try {
      Os.fsync(descriptor)
      return "synced"
    } catch (error: ErrnoException) {
      throw DurableFileFailure(
        "DIRECTORY_SYNC_FAILED",
        "The durable capture directory could not be synchronised.",
        true,
      )
    } finally {
      try {
        Os.close(descriptor)
      } catch (_: Exception) {
        // A close error after fsync does not invalidate the completed sync result.
      }
    }
  }

  private fun scanCaptureResidues(): Map<String, Any?> {
    val context = appContext.reactContext ?: throw DurableFileFailure(
      "DESTINATION_UNAVAILABLE",
      "Application storage context is unavailable.",
      true,
    )
    val root = durableRoot(context)
    val finals = mutableListOf<Map<String, Any?>>()
    val partials = mutableListOf<Map<String, Any?>>()
    root.listFiles()?.forEach { file ->
      when {
        file.isFile && file.name.endsWith(".capture") -> {
          val captureId = file.name.removeSuffix(".capture")
          try {
            validateCaptureId(captureId)
            val sha256 = hashFile(file)
            finals += mapOf(
              "artifact" to mapOf(
                "captureId" to captureId,
                "fileUri" to Uri.fromFile(file).toString(),
                "sha256" to sha256,
                "byteLength" to file.length(),
                "immutable" to true,
                "directorySync" to "synced",
              ),
              "integrity" to if (file.length() > 0L) "valid" else "corrupt",
            )
          } catch (_: Exception) {
            // A malformed filename cannot be associated with a ledger identity.
          }
        }
        file.isFile -> {
          val captureId = captureIdFromPartialName(file.name)
          if (captureId != null) {
            partials += mapOf(
              "captureId" to captureId,
              "fileUri" to Uri.fromFile(file).toString(),
            )
          }
        }
      }
    }
    synchronizeDirectory(root)
    return mapOf(
      "storageBoundaryVersion" to 1,
      "finals" to finals,
      "partials" to partials,
    )
  }

  private fun quarantineCaptureResidue(captureId: String, residue: String, reason: String) {
    validateCaptureId(captureId)
    if (residue != "final" && residue != "partial") {
      throw DurableFileFailure(
        "INVALID_SOURCE_URI",
        "Quarantine residue must be final or partial.",
        false,
      )
    }
    val context = appContext.reactContext ?: throw DurableFileFailure(
      "DESTINATION_UNAVAILABLE",
      "Application storage context is unavailable.",
      true,
    )
    val root = durableRoot(context)
    val quarantine = File(root, "quarantine")
    if ((!quarantine.exists() && !quarantine.mkdirs()) || !quarantine.isDirectory) {
      throw DurableFileFailure(
        "DESTINATION_UNAVAILABLE",
        "The protected quarantine directory could not be prepared.",
        true,
      )
    }
    Os.chmod(quarantine.absolutePath, 448) // 0700
    val safeReason = reason.replace(Regex("[^A-Za-z0-9_-]"), "_").take(48)
    val candidates = root.listFiles()?.filter { file ->
      if (residue == "final") {
        file.name == "$captureId.capture"
      } else {
        captureIdFromPartialName(file.name) == captureId
      }
    }.orEmpty()
    candidates.forEach { source ->
      val destination = File(
        quarantine,
        "$captureId.$safeReason.${UUID.randomUUID()}.quarantined",
      )
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          throw AtomicMoveNotSupportedException(
            source.absolutePath,
            destination.absolutePath,
            "Android API 26 or newer is required",
          )
        }
        atomicMove(source, destination)
        Os.chmod(destination.absolutePath, 256) // 0400
      } catch (_: Exception) {
        throw DurableFileFailure(
          "ATOMIC_RENAME_UNAVAILABLE",
          "The residue could not be moved into protected quarantine.",
          true,
        )
      }
    }
    synchronizeDirectory(root)
    synchronizeDirectory(quarantine)
  }

  private fun captureIdFromPartialName(name: String): String? {
    if (!name.startsWith(".") || !name.endsWith(".partial")) return null
    val withoutPrefix = name.removePrefix(".")
    val captureId = withoutPrefix.substringBefore(".", "")
    return if (captureIdPattern.matches(captureId)) captureId else null
  }

  private fun hashFile(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1_048_576)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (count == 0) continue
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { byte ->
      "%02x".format(byte.toInt() and 0xff)
    }
  }

  @android.annotation.TargetApi(Build.VERSION_CODES.O)
  private fun atomicMove(source: File, destination: File) {
    Files.move(
      source.toPath(),
      destination.toPath(),
      StandardCopyOption.ATOMIC_MOVE,
    )
  }

  private fun terminateForDurabilityOracle(): Nothing {
    Process.killProcess(Process.myPid())
    throw IllegalStateException("SIGKILL failure injection did not terminate the development process")
  }

  private data class CopyResult(val sha256: String, val byteLength: Long)

  private class DurableFileFailure(
    val code: String,
    val safeMessage: String,
    val retryable: Boolean,
  ) : Exception(safeMessage)
}
