import { PageHeader } from "@/components/page-header"
import { CorporateTaxWorkbench } from "@/components/tax-workbench"

export default function CorporateTaxPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Corporate Tax" title="Corporate tax by tax period" />
      <CorporateTaxWorkbench />
    </div>
  )
}
