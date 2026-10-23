import { AdjustmentsWorkbench } from "@/components/adjustments-workbench"
import { PageHeader } from "@/components/page-header"

export default function AdjustmentsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Adjusting entries" description="Prepaid expenses, depreciation and accruals, posted month by month to the trial balance and reports." />
      <AdjustmentsWorkbench />
    </div>
  )
}
