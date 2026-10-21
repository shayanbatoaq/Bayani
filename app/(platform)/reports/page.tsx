import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { ReportsWorkbench } from "@/components/reports-workbench"

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Reports" title="Financial statements" />
      <Suspense>
        <ReportsWorkbench />
      </Suspense>
    </div>
  )
}
