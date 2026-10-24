import { z } from "zod"

/**
 * The statement work for one company and year: the lines read from the uploaded
 * statements and the categories chosen, saved as the user works so nothing is lost
 * when they leave the page. The statement files themselves are not kept.
 */
const transaction = z.object({
  id: z.string().max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(2000),
  amount: z.number().finite(),
  balance: z.number().finite().nullable(),
  issue: z.string().max(300).optional(),
})
const account = z.object({
  key: z.string().max(120),
  currency: z.string().max(3),
  account: z.string().max(60),
  opening: z.number().finite().nullable(),
  closing: z.number().finite().nullable(),
  statedOpening: z.number().finite().nullable(),
  statedClosing: z.number().finite().nullable(),
  transactions: z.array(transaction).max(20000),
  verified: z.number().int().nonnegative(),
  mismatches: z.number().int().nonnegative(),
  from: z.string().max(10),
  to: z.string().max(10),
})
export const bankSessionSchema = z.object({
  files: z
    .array(z.object({ id: z.string().max(60), name: z.string().max(255), bank: z.string().max(80), warnings: z.array(z.string().max(400)).max(10), accounts: z.array(account).max(20) }))
    .max(40),
  overrides: z.record(z.string().max(80), z.string().max(160)),
  sessionRules: z.record(z.string().max(120), z.string().max(160)),
  rates: z.record(z.string().max(3), z.number().finite().nonnegative()),
  vatIncluded: z.boolean(),
  openingSource: z.enum(["retained", "capital", "owner", "loan"]),
  appliedAt: z.string().max(40).nullable(),
  /** 2: rates are the user's own rates into the base currency (1: rates into AED, now replaced by daily rates). */
  version: z.number().int().default(1),
  /** Per line and per payer/payee: the amount includes 5% VAT, or carries none. */
  vatChoices: z.record(z.string().max(80), z.enum(["incl", "none"])).default({}),
  vatRules: z.record(z.string().max(120), z.enum(["incl", "none"])).default({}),
  /** The VAT in the lines, for the VAT return (amounts in the base currency and in AED). */
  vatItems: z
    .array(
      z.object({
        id: z.string().max(80),
        date: z.string().max(10),
        description: z.string().max(300),
        kind: z.enum(["output", "input"]),
        net: z.number().finite(),
        vat: z.number().finite(),
        netAed: z.number().finite(),
        vatAed: z.number().finite(),
      }),
    )
    .max(20000)
    .default([]),
})
export type BankSession = z.infer<typeof bankSessionSchema>
