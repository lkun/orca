import { parseArgs } from 'node:util'
import type { CloudDatabase } from '@occ-cloud/cloud-database'
import { describeAccountHosts } from './connector-hosts.js'
import { LINK_OPTIONS, linkIdentity, required } from './operator-link.js'

// Discord ids are snowflakes: digits only.
const SNOWFLAKE = /^\d+$/

export const DISCORD_OPERATOR_USAGE = `Usage:
  link --guild <server id> --user <user id> --account <occ account id>
       [--default-host <host id>] [--default-project <name or owner/name>]
       [--channel-project <channel id>=<name or owner/name>]…
  hosts --account <occ account id>`

function snowflake(value: string | undefined, flag: string): string {
  if (!value || !SNOWFLAKE.test(value)) {
    throw new Error(`--${flag} needs a Discord id`)
  }
  return value
}

// Dogfood seeding, as for Slack: the bot and allowed servers come from the service's settings,
// and which OCC account each Discord user is from here.
export async function runDiscordOperator(
  argv: string[],
  deps: { database: CloudDatabase; now: () => number }
): Promise<string> {
  const [command, ...rest] = argv
  const { values } = parseArgs({
    args: rest,
    options: { ...LINK_OPTIONS, guild: { type: 'string' } }
  })
  switch (command) {
    case 'link':
      return await linkIdentity(
        deps.database,
        {
          source: 'discord',
          workspaceId: snowflake(values.guild, 'guild'),
          values,
          checkId: snowflake
        },
        deps.now()
      )
    case 'hosts':
      return await describeAccountHosts(deps.database, required(values.account, 'account'))
    default:
      throw new Error(DISCORD_OPERATOR_USAGE)
  }
}
