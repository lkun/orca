/** Set by `occ serve` on its occd child: '1' when a service manager supervises it, '' otherwise. */
export const OCC_SERVE_SUPERVISED_ENV = 'OCC_SERVE_SUPERVISED'

/** EX_TEMPFAIL: a supervised occd had no terminal daemon, so its terminals would die on restart. */
export const OCCD_EXIT_TERMINALS_NOT_DURABLE = 75
