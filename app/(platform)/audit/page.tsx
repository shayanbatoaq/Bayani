import { AuditRequestForm } from "@/components/audit-request-form"
import { PageHeader } from "@/components/page-header"

export default function AuditPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Audit" description="Request a quotation for an audit of your financial statements." />
      <AuditRequestForm />
    </div>
  )
}
