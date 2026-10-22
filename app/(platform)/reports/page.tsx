import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { ReportsWorkbench } from "@/components/reports-workbench"

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Financial statements" description="Statements and schedules for each saved year, ready as PDF or Excel." />
      <Suspense>
        <ReportsWorkbench />
      </Suspense>
    </div>
  )
}
