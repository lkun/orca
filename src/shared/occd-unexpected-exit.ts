import { z } from 'zod'

/** The previous occd on this data root died on this boot without releasing its instance lock. */
export const OCCdUnexpectedExitSchema = z.object({
  pid: z.number().int().positive(),
  version: z.string().max(255),
  /** When the exited run took the lock. */
  acquiredAt: z.iso.datetime({ offset: true })
})

export type OCCdUnexpectedExit = z.infer<typeof OCCdUnexpectedExitSchema>
