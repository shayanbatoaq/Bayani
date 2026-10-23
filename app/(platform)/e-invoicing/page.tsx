import { EInvoicingWorkbench } from "@/components/e-invoicing-workbench"
import { PageHeader } from "@/components/page-header"

export default function EInvoicingPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="E-invoicing" description="What the UAE e-invoicing rules require, the deadlines and penalties that apply to your company, and quotes from accredited service providers." />
      <EInvoicingWorkbench />
    </div>
  )
}
