import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'

export type InstallCopy = { ctaLabel: string; url: string }

export const ANDROID_INSTALL_GUIDE_URL = 'https://www.onocc.dev/docs/android-apk'

export function getInstallCopy(platform: Platform): InstallCopy {
  return platform === 'ios'
    ? {
        ctaLabel: translate(
          'auto.components.mobile.mobile.platform.copy.openAppStore',
          'Open App Store'
        ),
        url: 'https://apps.apple.com/app/occ-ide/id6766130217'
      }
    : {
        ctaLabel: translate(
          'auto.components.mobile.mobile.platform.copy.downloadApk',
          'Download APK'
        ),
        url: 'https://www.onocc.dev/download/android'
      }
}
