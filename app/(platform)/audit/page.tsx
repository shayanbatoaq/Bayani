import { ClipboardCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { ScoreCard } from "@/components/score-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { auditFindings, scoreCards } from "@/lib/mock-data"
import { AmaReviewPopup } from "@/components/ama-review-popup"

export default function AuditPage() {
  const auditScore = scoreCards.find(
    (score) => score.label === "Audit Readiness"
  )!

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Audit Intelligence"
        title="Audit readiness review"
        description="Potential audit findings and accounting quality signals are rule-triggered from mapped accounts and profile data."
        action={
          <AmaReviewPopup
            contactUrl={
              process.env.AMA_CONTACT_URL?.match(/^(https:\/\/|mailto:)/)
                ? process.env.AMA_CONTACT_URL
                : null
            }
          />
        }
      />
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <ScoreCard {...auditScore} />
        <Card>
          <CardHeader>
            <CardTitle>Potential Audit Findings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {auditFindings.map((finding) => (
              <div
                key={finding}
                className="flex gap-3 rounded-lg border bg-secondary/50 p-4 text-sm leading-6 text-muted-foreground"
              >
                <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                {finding}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Potential Risk Areas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            "Receivables",
            "Inventory",
            "Related Parties",
            "Revenue Recognition",
            "Cash Controls",
          ].map((area) => (
            <div
              key={area}
              className="rounded-lg border bg-card p-4 text-center text-sm font-medium"
            >
              {area}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
