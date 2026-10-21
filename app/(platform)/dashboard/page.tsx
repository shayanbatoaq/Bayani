import { CompanyManager } from "@/components/company-manager"
import { PageHeader } from "@/components/page-header"

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Dashboard" title="Your companies" />
      <CompanyManager />
    </div>
  )
}
