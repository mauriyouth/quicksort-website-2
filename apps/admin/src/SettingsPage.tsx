import { useClerk } from "@clerk/react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@quicksort-sas/ui";
import { SettingsCard, SettingsRow } from "./settings-ui";
import { AiSettings } from "./AiSettings";
import { GoogleDriveSettings } from "./GoogleDriveSettings";

export type SettingsSection = "account" | "ai" | "drive";

/**
 * Settings workspace — one SettingsCard per concern (settings-ui.tsx, on
 * @quicksort-sas/ui). The top-bar tabs (Account / AI configuration /
 * Google Drive contracts) are rendered by the shared SectionHeader in
 * App.tsx; this component renders only the active section's cards.
 */
export function SettingsPage({
  section,
  isOwner,
  email,
}: {
  section: SettingsSection;
  isOwner: boolean;
  email: string;
}) {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {section === "account" && <AccountCard email={email} />}
      {section === "ai" && <AiSettings isOwner={isOwner} />}
      {section === "drive" && <GoogleDriveSettings isOwner={isOwner} />}
    </div>
  );
}

/** Account — Google connection and active sessions, managed in Clerk's
 *  user profile. */
function AccountCard({ email }: { email: string }) {
  const clerk = useClerk();
  return (
    <SettingsCard
      title="Account"
      description="Manage your Google connection and active sessions."
      action={
        <Button variant="outline" size="sm" onClick={() => clerk.openUserProfile()}>
          Manage account <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      }
    >
      <SettingsRow label="Signed in as">
        <span className="num text-sm">{email}</span>
      </SettingsRow>
    </SettingsCard>
  );
}
