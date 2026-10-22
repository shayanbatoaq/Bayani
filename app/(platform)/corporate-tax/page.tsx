import { CtWorkbench } from "@/components/ct-workbench"
import { PageHeader } from "@/components/page-header"

export default function CorporateTaxPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Corporate Tax" title="Corporate tax return" />
      <CtWorkbench />
    </div>
  )
}
