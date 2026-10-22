import { PageHeader } from "@/components/page-header"
import { ValuationWorkbench } from "@/components/valuation-workbench"

export default function ValuationPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Business valuation" description="An indicative value for the company from its own figures, its industry and recognised valuation methods, with every step explained." />
      <ValuationWorkbench />
    </div>
  )
}
