import { CompanyManager } from "@/components/company-manager"
import { PageHeader } from "@/components/page-header"

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Your companies" description="Add a company from its licence, MOA and tax certificates. Everything else builds on these details." />
      <CompanyManager />
    </div>
  )
}
