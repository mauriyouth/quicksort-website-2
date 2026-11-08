import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { db, errorMessage, type Row } from "@quicksort/hr-db";
import { formatDate } from "@quicksort/hr-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts, StatusBadge } from "./ui";

type Confirmation = { email: string; decision: string };

const CONFIRM_VERB: Record<string, string> = {
  approved: "approval",
  revoked: "revocation",
  rejected: "rejection",
};

export function AccessManager() {
  const [requests, setRequests] = useState<Row<"admin_access_requests">[]>([]),
    [profiles, setProfiles] = useState<Row<"profiles">[]>([]),
    [roles, setRoles] = useState<Row<"user_roles">[]>([]),
    [owners, setOwners] = useState<Row<"portal_owners">[]>([]),
    [audit, setAudit] = useState<Row<"admin_access_audit">[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const load = useCallback(async () => {
    try {
      const results = await Promise.all([
        db().from("admin_access_requests").select("*").order("created_at", { ascending: false }),
        db().from("profiles").select("*"),
        db().from("user_roles").select("*"),
        db().from("portal_owners").select("*"),
        db().from("admin_access_audit").select("*").order("created_at", { ascending: false }).limit(50),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setRequests(results[0].data || []);
      setProfiles(results[1].data || []);
      setRoles(results[2].data || []);
      setOwners(results[3].data || []);
      setAudit(results[4].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const email = (id: string) => profiles.find((p) => p.id === id)?.email || id;
  const isOwner = (id: string) => owners.some((o) => o.user_id === id);
  async function decide() {
    if (!confirmation) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error } = await db().rpc("review_admin_access", { target_email: confirmation.email, decision: confirmation.decision });
      if (error) throw error;
      setMessage(`Access ${confirmation.decision} for ${confirmation.email}.`);
      setConfirmation(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmation(null);
    } finally {
      setBusy(false);
    }
  }
  async function assignRole(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const f = new FormData(form);
      const target = String(f.get("email")).trim();
      const { error } = await db().rpc("assign_workspace_role", { target_email: target, role: String(f.get("role")) });
      if (error) throw error;
      setMessage(`Workspace rights assigned for ${target}.`);
      form.reset();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeRole(userId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error } = await db().rpc("assign_workspace_role", { target_email: email(userId), role: "candidate" });
      if (error) throw error;
      setMessage(`Workspace rights removed for ${email(userId)}.`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function grant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfirmation({ email: String(new FormData(e.currentTarget).get("email")).trim(), decision: "approved" });
  }
  const staffRoles = (["employee", "hr", "sales"] as const).flatMap((r) => roles.filter((x) => x.role === r));
  return (
    <div className="flex flex-col gap-6">
      <PageAlerts error={error} message={message} />

      <AlertDialog open={!!confirmation} onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm access change</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{confirmation?.email}</strong> will have their admin access{" "}
              <strong className="text-foreground">{confirmation?.decision}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.decision === "approved" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void decide()}
            >
              Confirm {CONFIRM_VERB[confirmation?.decision ?? ""] ?? confirmation?.decision}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Section title="Approve an existing account" description="Ask the person to sign in first, then enter their verified account email.">
        <form onSubmit={grant}>
          <FieldGroup>
            <EmailField />
            <div>
              <Button type="submit" disabled={busy}>Review approval</Button>
            </div>
          </FieldGroup>
        </form>
      </Section>

      <Section
        title="Access requests"
        action={
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" />
            Refresh requests
          </Button>
        }
      >
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading access requests…</p>
        ) : requests.length === 0 ? (
          <EmptyState title="No requests yet">People can request admin access after signing in.</EmptyState>
        ) : (
          <ItemGroup>
            {requests.map((r) => (
              <PersonRow
                key={r.user_id}
                title={email(r.user_id)}
                status={r.status}
                detail={`Requested ${formatDate(r.created_at)}`}
                actions={
                  <>
                    {r.status !== "approved" && (
                      <Button size="sm" disabled={busy} onClick={() => setConfirmation({ email: email(r.user_id), decision: "approved" })}>
                        Approve
                      </Button>
                    )}
                    {r.status === "pending" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation({ email: email(r.user_id), decision: "rejected" })}>
                        Reject
                      </Button>
                    )}
                  </>
                }
              />
            ))}
          </ItemGroup>
        )}
      </Section>

      <Section title="Current administrators" description="Owner accounts are protected from removal here.">
        <ItemGroup>
          {roles
            .filter((r) => r.role === "admin")
            .map((r) => (
              <PersonRow
                key={r.user_id}
                title={email(r.user_id)}
                status={isOwner(r.user_id) ? "owner" : "admin"}
                actions={
                  !isOwner(r.user_id) && (
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmation({ email: email(r.user_id), decision: "revoked" })}>
                      Revoke access
                    </Button>
                  )
                }
              />
            ))}
        </ItemGroup>
      </Section>

      <Section
        title="Workspace rights"
        description="Fine-grained staff rights: employee, HR, or sales. Admin access is reviewed above; owner accounts are excluded."
      >
        <form onSubmit={assignRole}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <EmailField />
              <Field>
                <FieldLabel htmlFor="access-role">Role</FieldLabel>
                <NativeSelect id="access-role" name="role" defaultValue="employee">
                  <NativeSelectOption value="employee">Employee</NativeSelectOption>
                  <NativeSelectOption value="hr">HR</NativeSelectOption>
                  <NativeSelectOption value="sales">Sales</NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
            <div>
              <Button type="submit" disabled={busy}>Assign rights</Button>
            </div>
          </FieldGroup>
        </form>
        {staffRoles.length ? (
          <ItemGroup className="mt-2">
            {staffRoles.map((x) => (
              <PersonRow
                key={x.user_id}
                title={email(x.user_id)}
                status={x.role}
                actions={
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeRole(x.user_id)}>
                    Remove rights
                  </Button>
                }
              />
            ))}
          </ItemGroup>
        ) : (
          <p className="text-sm text-muted-foreground">No staff rights assigned yet.</p>
        )}
      </Section>

      <Section title="Recent access changes">
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No access changes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {audit.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <span>
                  {email(item.actor_id)}{" "}
                  {item.action === "impersonated" ? "impersonated" : item.action === "created" ? "created an account for" : `${item.action} access for`}{" "}
                  {email(item.target_id)}
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function EmailField() {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Email address</FieldLabel>
      <Input id={id} name="email" type="email" required placeholder="colleague@quicksort.fr" />
    </Field>
  );
}

function PersonRow({ title, status, detail, actions }: { title: string; status: string; detail?: string; actions?: ReactNode }) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <span className="truncate">{title}</span>
          <StatusBadge status={status} />
        </ItemTitle>
        {detail && <ItemDescription>{detail}</ItemDescription>}
      </ItemContent>
      {actions && <ItemActions>{actions}</ItemActions>}
    </Item>
  );
}
