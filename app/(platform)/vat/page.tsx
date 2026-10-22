import { PageHeader } from "@/components/page-header"
import { VatWorkbench } from "@/components/vat-workbench"

export default function VatPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="VAT" title="VAT returns" />
      <VatWorkbench />
    </div>
  )
}
