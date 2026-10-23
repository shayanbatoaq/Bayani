import { InvoicesWorkbench } from "@/components/invoices-workbench"
import { PageHeader } from "@/components/page-header"

export default function InvoicesPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Invoices" description="Issue tax invoices and credit notes, follow what each client owes, and see sales, receivables and VAT update in your reports as you go." />
      <InvoicesWorkbench />
    </div>
  )
}
