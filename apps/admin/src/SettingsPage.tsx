import { useClerk } from "@clerk/react";
import { ArrowUpRight } from "lucide-react";
import { AiSettings } from "./AiSettings";
import { BoondImport } from "./BoondImport";
import { GoogleDriveSettings } from "./GoogleDriveSettings";
import "./settings-page.css";

export type SettingsSection = "account" | "ai" | "drive";

/**
 * Settings workspace — one card per concern, matching the reference
 * Settings design. The top-bar tabs (Account / AI configuration /
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
    <div className="settings-page">
      {section === "account" && <AccountCard email={email} />}
      {section === "ai" && <AiSettings isOwner={isOwner} />}
      {section === "drive" && <GoogleDriveSettings isOwner={isOwner} />}
      {section === "account" && <BoondImport isOwner={isOwner} />}
    </div>
  );
}

/** Account — Google connection and active sessions, managed in Clerk's
 *  user profile. */
function AccountCard({ email }: { email: string }) {
  const clerk = useClerk();
  return (
    <section className="sp-card" aria-label="Account">
      <header className="sp-card-head">
        <div>
          <h2 className="sp-card-title">Account</h2>
          <p className="sp-card-desc">
            Manage your Google connection and active sessions.
          </p>
        </div>
        <button
          type="button"
          className="sp-btn-ghost"
          onClick={() => clerk.openUserProfile()}
        >
          Manage account <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="sp-row">
        <div className="sp-row-label">Signed in as</div>
        <div className="sp-mono">{email}</div>
      </div>
    </section>
  );
}
