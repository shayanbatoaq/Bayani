import { PageHeader } from "@/components/page-header"
import { FinancialDataInput } from "@/components/financial-data-input"

export default function DataInputPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Trial balance by year" description="Enter each year as closing balances or as movements, head by head." />
      <FinancialDataInput />
    </div>
  )
}
