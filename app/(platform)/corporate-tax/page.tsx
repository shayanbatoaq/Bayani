import { CtWorkbench } from "@/components/ct-workbench"
import { PageHeader } from "@/components/page-header"

export default function CorporateTaxPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Corporate tax return" description="The EmaraTax return built from your figures, with the computation explained." />
      <CtWorkbench />
    </div>
  )
}
