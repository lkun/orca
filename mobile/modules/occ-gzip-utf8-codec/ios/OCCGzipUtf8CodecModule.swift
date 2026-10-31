import ExpoModulesCore

// Sync avoids a thread hop when reading Uint8Array; each window takes only a few ms.
public class OCCGzipUtf8CodecModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OCCGzipUtf8Codec")

    Function("gunzip") { (input: Data, outputLimit: Int) throws -> Data in
      try gunzipBounded(input, outputLimit: outputLimit)
    }

    Function("decodeUtf8") { (input: Data) -> String? in
      decodeStrictUtf8(input)
    }
  }
}
