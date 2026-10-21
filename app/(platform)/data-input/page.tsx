import { PageHeader } from "@/components/page-header"
import { FinancialDataInput } from "@/components/financial-data-input"

export default function DataInputPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Data Input"
        title="Trial balance"
      />
      <FinancialDataInput />
    </div>
  )
}
