import { Suspense } from 'react';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { hasFinance, ROLE_INFO, requireActive } from '@/lib/auth';
import { ChangePasswordForm } from './ChangePasswordForm';

export default function AccountPage() {
  return <Suspense fallback={<PageLoading />}><Account /></Suspense>;
}

async function Account() {
  const user = await requireActive();
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Signed in as">
          <p className="font-medium">{user.fullName}</p>
          <p className="text-sm text-ink-2">{user.email}</p>
          {hasFinance(user) && (
            <p className="mt-2 text-sm">Finance: <span className="capitalize">{user.role}</span>, <span className="text-ink-2">{ROLE_INFO[user.role]}</span></p>
          )}
        </Card>
        <Card title="Change password">
          <ChangePasswordForm />
        </Card>
      </div>
    </>
  );
}
