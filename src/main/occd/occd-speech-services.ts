import { ModelManager } from '../speech/model-manager'
import { openNodeSpeechDownloadRequest } from '../speech/node-speech-download-request'
import { canReadOpenAiSpeechApiKey } from '../speech/openai-api-key-store'
import type { SpeechServiceFactories } from '../speech/speech-runtime-service'
import { SttService } from '../speech/stt-service'
import { spawnSttForkedProcess } from '../speech/stt-worker-forked-process'

// Local speech needs the installed app recognizer supplied by occ serve.
export const occdSpeechServiceFactories: SpeechServiceFactories = {
  createModelManager: (customModelsDir) =>
    // Headless key reads cannot open keychain prompts, so readiness may verify decryption.
    new ModelManager(customModelsDir, openNodeSpeechDownloadRequest, canReadOpenAiSpeechApiKey),
  createSttService: (models) => new SttService(models, spawnSttForkedProcess)
}
