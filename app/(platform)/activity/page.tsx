import { ActivityLog } from "@/components/activity-log"
import { PageHeader } from "@/components/page-header"

export default function ActivityPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Activity log" description="What was changed and when, across every company." />
      <ActivityLog />
    </div>
  )
}
