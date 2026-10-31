/** Desktop and occ serve share the app’s platform recognizer addon; occd slots omit the ~70 MB package. */

/** Set by `occ serve` for occd: the directory of the app's recognizer package. */
export const SPEECH_RECOGNIZER_DIR_ENV = 'OCC_SPEECH_RECOGNIZER_DIR'

export function speechRecognizerPackageName(platform: string, arch: string): string {
  return platform === 'win32' && arch === 'x64'
    ? 'sherpa-onnx-win-x64'
    : `sherpa-onnx-${platform}-${arch}`
}
