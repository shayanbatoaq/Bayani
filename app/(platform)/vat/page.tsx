import { PageHeader } from "@/components/page-header"
import { VatWorkbench } from "@/components/tax-workbench"

export default function VatPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="VAT" title="VAT by return period" />
      <VatWorkbench />
    </div>
  )
}
