import { useTranslate } from '../../../../i18n/use-translate'
import { useAppStore } from '../../../../store/index'
import { OCCSignInButton, OCCSignInWaitNotice } from '../../../OCCSignInProgress'

export function MobileRelaySignInPanel({
  reconnectRequired
}: {
  reconnectRequired: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const browserWaiting = useAppStore((state) => Boolean(state.occProfileSignInProgress?.link))

  return (
    <div
      // Why role-less: a radiogroup may only own radios; this div is layout under the Relay radio.
      onKeyDown={(event) => {
        // Why: arrow keys on nested controls must not change the selected path.
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.stopPropagation()
        }
      }}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-accent/40 py-2.5 pl-10 pr-3"
      data-testid="anywhere-sign-in-panel"
    >
      {browserWaiting ? (
        <OCCSignInWaitNotice className="min-w-0 flex-1" />
      ) : (
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {t(
            'auto.components.settings.MobilePairingConnectionOptions.relaySignInDetail',
            'Signs this desktop in to OCC and routes the phone through OCC’s servers. LAN does not need an account.'
          )}
        </p>
      )}
      <OCCSignInButton size="sm" className="shrink-0">
        {reconnectRequired
          ? t(
              'auto.components.settings.MobilePairingConnectionOptions.signInAgain',
              'Sign in again for Relay'
            )
          : t(
              'auto.components.settings.MobilePairingConnectionOptions.signIn',
              'Sign in for Relay'
            )}
      </OCCSignInButton>
    </div>
  )
}
