import { BillsWorkbench } from "@/components/bills-workbench"
import { PageHeader } from "@/components/page-header"

export default function BillsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Bills" description="Upload a bill, receipt or purchase invoice and Bayani reads it. Expenses, reclaimable VAT and what you owe each supplier update in your reports." />
      <BillsWorkbench />
    </div>
  )
}
