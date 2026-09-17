import { getProjectLabels } from '@/lib/project-workspace';
import { requireMember } from '@/lib/auth';
import { ProjectLabels } from '@/components/project-labels';
export default async function LabelsPage() {
  const [labels, profile] = await Promise.all([getProjectLabels(), requireMember()]);
  return <ProjectLabels labels={labels} canManage={['admin', 'manager'].includes(profile.role)} />;
}
