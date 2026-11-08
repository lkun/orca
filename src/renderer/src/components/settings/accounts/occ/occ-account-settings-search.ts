import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../../search/settings-search-keywords'

export const getOCCAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.occAccount.account', 'OCC account'),
    description: translate(
      'auto.components.settings.occAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and OCC Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.occAccount.keywordCloud', 'cloud')
    ]
  }
])
