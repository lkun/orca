import { OCC_SESSION_ADDRESS_PREFIX } from '../../../../shared/occ-session-address-prefix'

/** Format bare ids as session addresses (NULL stays NULL); never strip addresses and risk matching handles or Runs. */
export function occSessionAddressSql(occSessionIdSql: string): string {
  return `('${OCC_SESSION_ADDRESS_PREFIX}' || ${occSessionIdSql})`
}
