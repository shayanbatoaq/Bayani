import Link from "next/link"
import { ArrowRight, FileText, Sparkles, Upload } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { ScoreCard } from "@/components/score-card"
import { ScoreDistribution } from "@/components/charts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  recentAssessments,
  scoreCards,
  topOpportunities,
  topRisks,
} from "@/lib/mock-data"

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Executive Dashboard"
        title="Financial intelligence command center"
        description="Scores, risk flags, opportunities, recent assessments, and CFO commentary generated from system-calculated outputs."
        action={
          <Button asChild>
            <Link href="/data-input">
              <Upload className="size-4" />
              New assessment
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scoreCards.map((score) => (
          <ScoreCard key={score.label} {...score} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              AI CFO Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>
              FinScope AI calculates a Business Health Score of 82 from liquidity, profitability, leverage, compliance, and benchmark indicators. The business appears commercially healthy with targeted documentation cleanup required before audit, tax, or funding review.
            </p>
            <p>
              Commentary is indicative, requires professional review, and is not professional advice.
            </p>
            <Button asChild variant="outline">
              <Link href="/final-report">
                Open final report
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <ScoreDistribution data={scoreCards.map((score) => ({ label: score.label.replace(" Readiness", ""), value: score.value }))} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <RiskList title="Top Risks" items={topRisks} tone="risk" />
        <RiskList title="Top Opportunities" items={topOpportunities} tone="opportunity" />
        <Card>
          <CardHeader>
            <CardTitle>Recent Assessments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentAssessments.map((assessment) => (
              <div key={assessment.id} className="rounded-lg border bg-secondary/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{assessment.company}</p>
                  <Badge variant="outline">{assessment.score}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {assessment.id} - {assessment.date} - {assessment.status}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Button asChild variant="outline">
            <Link href="/data-input">
              <FileText className="size-4" />
              Review trial balance
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/final-report">Generate PDF report</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/audit">Request expert review</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function RiskList({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: "risk" | "opportunity"
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item} className="rounded-lg border bg-card p-3 text-sm leading-5">
            <Badge
              variant="outline"
              className={tone === "risk" ? "mb-2 border-amber-200 bg-amber-50 text-amber-800" : "mb-2 border-emerald-200 bg-emerald-50 text-emerald-700"}
            >
              {tone === "risk" ? "Watch" : "Upside"}
            </Badge>
            <p className="text-muted-foreground">{item}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
