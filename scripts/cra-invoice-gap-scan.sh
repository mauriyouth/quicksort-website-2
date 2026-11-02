#!/bin/bash
# One-shot CRA-invoicing job against the local admin API (port 5174):
#   1. reads invoicing settings
#   2. pushes start_month back to 2026-01 (no invoice row is touched —
#      Qonto-imported invoices stay as-is and already count as coverage)
#   3. scans every month from 2026-01 through the current Paris month and
#      prints the consultant/project/month rows with no invoice yet
# Usage: QS_TOKEN=<clerk supabase-template jwt> cra-invoice-gap-scan.sh
set -euo pipefail

API="${API:-http://127.0.0.1:5174/api/invoicing}"
TOKEN="${QS_TOKEN:?Set QS_TOKEN to a fresh Clerk token: copy(await window.Clerk.session.getToken({template:\"supabase\"}))}"
CURRENT_MONTH="$(TZ=Europe/Paris date +%Y-%m)"
OUT="$(mktemp -t cra-gap)"

req() { # method path body
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sf -X "$method" "$API$path" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body"
  else
    curl -sf -X "$method" "$API$path" -H "Authorization: Bearer $TOKEN"
  fi
}

echo "== settings (before) ==" | tee "$OUT"
SETTINGS="$(req GET '?resource=settings')"
echo "$SETTINGS" | jq '{startMonth, provider, login, iban, staging, dueDays, hasSecret}' | tee -a "$OUT"

LOGIN="$(echo "$SETTINGS" | jq -r .login)"
IBAN="$(echo "$SETTINGS" | jq -r .iban)"
STAGING="$(echo "$SETTINGS" | jq -r .staging)"
DUEDAYS="$(echo "$SETTINGS" | jq -r .dueDays)"

echo | tee -a "$OUT"
echo "== pushing startMonth to 2026-01 ==" | tee -a "$OUT"
req POST '' "$(jq -cn --arg login "$LOGIN" --arg iban "$IBAN" --argjson staging "$STAGING" --argjson dueDays "$DUEDAYS" \
  '{action:"save_settings", login:$login, iban:$iban, staging:$staging, dueDays:$dueDays, startMonth:"2026-01"}')" | tee -a "$OUT"
echo | tee -a "$OUT"

echo "== settings (after) ==" | tee -a "$OUT"
req GET '?resource=settings' | jq '{startMonth, lastSyncedAt}' | tee -a "$OUT"
echo | tee -a "$OUT"

echo "== scanning 2026-01 .. $CURRENT_MONTH ==" | tee -a "$OUT"
MONTHS=()
m="2026-01"
while [ "$m" \< "$CURRENT_MONTH" ]; do MONTHS+=("$m"); m=$(date -j -f %Y-%m -v+1m "$m" +%Y-%m 2>/dev/null || date -d "$m-01 +1 month" +%Y-%m); done

FIRST=1
for month in "${MONTHS[@]}"; do
  ROWS="$(req GET "?resource=month&month=$month" | jq -c '.rows[] | select(.status=="not_invoiced") | {month:"'$month'", consultantName, projectTitle, billedClientName, days, amountHt, blockers, warnings}')"
  if [ -n "$ROWS" ]; then
    [ $FIRST -eq 1 ] && { echo "MISSING INVOICES (not yet issued):" | tee -a "$OUT"; printf '%-8s %-22s %-28s %-22s %4s %10s  %s\n' MONTH CONSULTANT PROJECT CLIENT DAYS "AMOUNT HT" NOTES | tee -a "$OUT"; FIRST=0; }
    while IFS= read -r row; do
      printf '%-8s %-22s %-28s %-22s %4s %10s  %s\n' \
        "$month" \
        "$(echo "$row" | jq -r .consultantName)" \
        "$(echo "$row" | jq -r .projectTitle | cut -c1-28)" \
        "$(echo "$row" | jq -r .billedClientName | cut -c1-22)" \
        "$(echo "$row" | jq -r .days)" \
        "$(echo "$row" | jq -r '.amountHt // "-"' )" \
        "$(echo "$row" | jq -r '([.blockers[], .warnings[]] | join(", ")) // ""')" | tee -a "$OUT"
    done <<< "$ROWS"
  fi
done
[ $FIRST -eq 1 ] && echo "No missing invoices in that range." | tee -a "$OUT"

echo | tee -a "$OUT"
echo "(full JSON rows kept in $OUT)"
