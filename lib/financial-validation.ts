import { z } from "zod"
import { scheduleLines } from "./financial-statements"

const money = z
  .number()
  .finite()
  .min(-1e9)
  .max(1e9)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001,
    "Amounts must have no more than two decimal places"
  )
const opening = z.object({
  capital: money,
  earnings: money,
  retained: money,
  shareholder: money,
})
export const financialInputSchema = z
  .object({
    clientId: z.string().uuid(),
    clientName: z.string().trim().min(1).max(160),
    year: z.number().int().min(1900).max(2200),
    currency: z.enum(["AED", "USD", "GBP", "EUR", "PKR"]),
    openingEquity: opening.nullable(),
    rows: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          ledgerName: z.string().trim().min(1).max(250),
          amount: money,
          scheduleKey: z
            .string()
            .refine(
              (key) =>
                key === "" || scheduleLines.some((line) => line.key === key)
            ),
        })
      )
      .min(1)
      .max(10000),
    revision: z.number().int().nonnegative().default(0),
  })
  .superRefine((data, context) => {
    if (new Set(data.rows.map((row) => row.id)).size !== data.rows.length)
      context.addIssue({
        code: "custom",
        message: "Ledger IDs must be unique",
        path: ["rows"],
      })
  })
