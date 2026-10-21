import { PageHeader } from "@/components/page-header"
import { FinancialReportWorkbench } from "@/components/financial-report-workbench"

export default function FinalReportPage() {
  return <div className="space-y-8"><PageHeader eyebrow="Final Report" title="Client financial statements" /><FinancialReportWorkbench /></div>
}
