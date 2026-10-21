import { CompanyManager } from "@/components/company-manager"
import { PageHeader } from "@/components/page-header"

export default function ProfilePage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Profile" title="Your account and company" />
      <CompanyManager />
    </div>
  )
}
