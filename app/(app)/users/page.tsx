import { Suspense } from 'react';
import { asc } from 'drizzle-orm';
import { ActionButton } from '@/components/ActionButton';
import { Card, PageHeader, PageLoading } from '@/components/ui';
import { can, ROLE_INFO, requireUser, type Role } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { createUser, deleteUser, setPassword, updateUser } from './actions';
import { CreateUserForm, EditUserForm, PasswordForm } from './UserForms';

export default function UsersPage() {
  return <Suspense fallback={<PageLoading />}><Users /></Suspense>;
}

async function Users() {
  const me = await requireUser();
  if (!can(me, 'manageUsers')) {
    return (
      <>
        <PageHeader title="Users & access" />
        <Card><p className="text-sm text-ink-2">Only owners and admins can manage logins.</p></Card>
      </>
    );
  }
  const users = await db.select().from(profiles).orderBy(asc(profiles.fullName));
  const waiting = users.filter((u) => !u.isActive);
  return (
    <>
      <PageHeader title="Users & access" subtitle="Who can sign in, and what each person is allowed to do." />
      <Card title="Roles" className="mb-4">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {(Object.keys(ROLE_INFO) as Role[]).filter((r) => r !== 'none').map((r) => (
            <li key={r}><span className="font-medium capitalize">{r}</span>: <span className="text-ink-2">{ROLE_INFO[r]}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          A login only works when it is <strong>Active</strong>. Untick Active to block someone at once (they are signed out
          everywhere); Delete removes the login completely.
        </p>
      </Card>
      {waiting.length > 0 && (
        <p className="mb-4 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          {waiting.length === 1 ? '1 login is' : `${waiting.length} logins are`} switched off and cannot see anything:{' '}
          {waiting.map((u) => u.email).join(', ')}. If you don&apos;t know them, delete them.
        </p>
      )}
      <Card title="Add a login" className="mb-4">
        <CreateUserForm action={createUser} />
      </Card>
      <Card title={`Logins (${users.length})`}>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Access and status</th><th>Reset password</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const protectedOwner = u.role === 'owner' && me.role !== 'owner';
                return (
                  <tr key={u.id}>
                    <td className="font-medium">{u.fullName}{u.id === me.id && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                    <td>{u.email}</td>
                    <td>
                      <EditUserForm action={updateUser.bind(null, u.id)} role={u.role} isActive={u.isActive} disabled={protectedOwner || u.id === me.id} />
                    </td>
                    <td>{u.id !== me.id && !protectedOwner && <PasswordForm action={setPassword.bind(null, u.id)} />}</td>
                    <td className="text-right">
                      {u.id !== me.id && !protectedOwner && (
                        <ActionButton
                          action={deleteUser.bind(null, u.id)}
                          label="Delete"
                          confirm={`Delete the login ${u.email}? They will lose access immediately. This can't be undone.`}
                          className="btn btn-danger px-2 py-1 text-xs"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
