import { PageHeader } from "@/components/page-header"
import { VatWorkbench } from "@/components/vat-workbench"

export default function VatPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="VAT returns" description="Upload each VAT 201 return or type it in. FinScope keeps the tax year together and flags what needs attention." />
      <VatWorkbench />
    </div>
  )
}
