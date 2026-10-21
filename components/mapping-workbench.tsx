"use client"

import { AlertTriangle, CheckCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { mappingCategories } from "@/lib/mock-data"
import type { LedgerRow } from "@/lib/trial-balance"
import { cn } from "@/lib/utils"
import { scheduleLines } from "@/lib/financial-statements"

export function MappingWorkbench({
  rows,
  onChange,
  onConfirm,
  onScheduleChange,
}: {
  rows: LedgerRow[]
  onChange: (id: string, category: string) => void
  onConfirm: () => void
  onScheduleChange?: (id: string, scheduleKey: string) => void
}) {
  const pending = rows.filter((row) => row.confidence !== "Reviewed").length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {pending
            ? `${pending} mappings to review on this page`
            : "All mappings on this page reviewed"}
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={!pending || rows.some((row) => !row.category)}
          onClick={onConfirm}
        >
          <CheckCheck className="size-4" />
          Accept page suggestions
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name of ledger</TableHead>
              <TableHead>Standard category</TableHead>
              {onScheduleChange && <TableHead>Financial schedule</TableHead>}
              <TableHead>Confidence</TableHead>
              <TableHead>Rationale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={
                  row.confidence === "Low" ? "bg-amber-50/60" : undefined
                }
              >
                <TableCell className="min-w-44 max-w-72 whitespace-normal font-medium">
                  <span className="flex items-center gap-2">
                    {row.confidence === "Low" && (
                      <AlertTriangle className="size-4 shrink-0 text-amber-700" />
                    )}
                    <span className="break-words">{row.ledgerName}</span>
                  </span>
                </TableCell>
                <TableCell className="min-w-56">
                  <Select
                    value={row.category}
                    onValueChange={(value) => onChange(row.id, value)}
                  >
                    <SelectTrigger
                      className="w-full bg-white"
                      aria-label={`Category for ${row.ledgerName}`}
                    >
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {mappingCategories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                {onScheduleChange && (
                  <TableCell className="min-w-72">
                    <select
                      aria-label={`Schedule for ${row.ledgerName}`}
                      value={row.scheduleKey ?? ""}
                      onChange={(event) =>
                        onScheduleChange(row.id, event.target.value)
                      }
                      className="h-10 w-full max-w-80 rounded-md border bg-white px-2 text-sm"
                    >
                      <option value="">Select schedule</option>
                      {scheduleLines.map((line) => (
                        <option key={line.key} value={line.key}>
                          {line.note}. {line.label}
                          {line.key === "taxReceivable"
                            ? " (receivable)"
                            : line.key === "taxPayable"
                              ? " (payable)"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                )}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border",
                      row.confidence === "Reviewed"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    )}
                  >
                    {row.confidence}
                  </Badge>
                </TableCell>
                <TableCell className="min-w-48 max-w-80 whitespace-normal text-sm text-muted-foreground">
                  {row.rationale}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
