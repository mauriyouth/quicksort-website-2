## 1. Overview

The Quicksort Sales module is a CRM-style pipeline workspace embedded in the existing operations application. It tracks client companies, people inside those clients, internal champions (“sponsors”), and sales opportunities.

Most opportunities are sold as **régie** engagements — time-and-materials work billed at a **TJM** (*tarif journalier moyen*, average daily rate) and estimated by number of days. Some opportunities are sold as **forfait** — fixed-price engagements. The module must handle both pricing models cleanly across pipeline value, forecast, search, filtering, and reporting.

The experience is inspired by modern CRM tools such as Pipedrive and Bond Manager: fast search, clear relationship context, drag-and-drop pipeline management, and opportunity-level sponsor mapping.

---

## 2. Problem Statement

Quicksort needs a sales workspace inside its operations application that answers day-to-day pipeline questions without switching tools:

- Which clients are active, healthy, stale, or at risk?
- Who are the relevant people inside each client?
- Which opportunities have a strong internal champion?
- What is the current open pipeline value?
- How much of the pipeline is régie versus forfait?
- Which deals are closing soon or need attention?
- Who should be engaged next to move a deal forward?

---

## 3. Goals

### Primary goals

- Add a searchable sales workspace under `/sales`.
- Track clients, people, sponsors, and opportunities in one place.
- Support both régie (TJM) and forfait opportunity pricing.
- Visualize pipeline by stage and allow drag-and-drop stage movement.
- Associate internal champions/sponsors to opportunities with influence levels.
- Give each client a 360° view: company info, people, opportunities, activity, and notes.
- Provide forecast and pipeline-health views for sales review.

### Non-goals

- No separate standalone CRM login.
- No new authentication system outside the existing operations application.
- No external email/calendar synchronization in the first release.
- No accounting, invoicing, or contract generation in the first release.
- No public-facing client portal.

---

## 4. Integration Requirements

Because this module lives inside the existing Quicksort operations application:

- All pages must be available under `/sales`.
- The module must use the existing application shell, navigation, permissions, and notification patterns.
- No separate login flow should be introduced.
- User identity, ownership, and permissions must come from the existing operations application.
- Sales data must be stored in the operations application’s existing data layer.
- Deep links must be shareable inside the company, subject to existing permissions.
- If the operations application already has global search, sales records should be included; otherwise the module provides scoped sales search.
- Visual design should match the existing operations application rather than introducing a separate product look.

---

## 5. Target Users

- Sales representatives managing opportunities.
- Sales leads reviewing forecast and pipeline health.
- Account managers tracking client relationships.
- Delivery or operations leads who need visibility into upcoming sold work.
- Founders/management reviewing pipeline value and coverage.

---

## 6. Scope

### In scope

- Sales dashboard.
- Pipeline kanban board.
- Clients directory and client detail pages.
- People directory and person drawer.
- Opportunities list, forecast, and opportunity drawer.
- Régie (TJM) and forfait pricing model support.
- Sponsor/champion association on opportunities.
- Activity timeline and notes.
- Search across clients, people, and opportunities.

### Out of scope for first release

- Contract generation.
- Invoicing or revenue recognition.
- Email/calendar sync.
- Automated lead enrichment.
- External CRM migration tools.
- Client-facing portal.

---

## 7. Product Experience

### Routes

| Route | Purpose |
| --- | --- |
| `/sales` | Sales dashboard |
| `/sales/pipeline` | Drag-and-drop opportunity kanban |
| `/sales/clients` | Searchable client directory |
| `/sales/clients/:id` | Client 360 detail page |
| `/sales/people` | People directory across all clients |
| `/sales/opportunities` | Opportunities list, forecast, and detail drawer |

### Shared UI patterns

- Sales search available from the module header and integrated into existing app search if available.
- “New” actions for opportunity, client, and person.
- Drawers for opportunity and person details.
- Consistent badges for stage, client health, sponsor influence, and pricing model.
- Responsive behavior for desktop, tablet, and mobile.

---

## 8. Functional Requirements

### 8.1 Sales dashboard

**Priority:** P0

The dashboard is the sales command center.

Requirements:

- Show open pipeline value.
- Show weighted forecast value.
- Show split between régie and forfait pipeline.
- Show number of open opportunities.
- Show deals closing soon.
- Show stale or at-risk deals.
- Show stage funnel.
- Show recent activity.
- Show upcoming closes grouped by week or month.

Acceptance criteria:

- Dashboard values match the underlying opportunity records.
- Régie and forfait amounts are calculated correctly.
- Clicking a deal, client, or activity navigates to the correct sales record.

---

### 8.2 Pipeline kanban

**Priority:** P0

The pipeline page manages opportunities by stage.

Requirements:

- Display stages: Lead, Qualified, Meeting, Proposal, Negotiation, Won, Lost.
- Support drag-and-drop between stages.
- Show live column count and total value.
- Support filtering by owner, client, pricing model, amount, and search text.
- Support quick-add opportunity.
- Moving to Won or Lost updates probability and logs activity.
- Lost deals require a reason.
- For régie deals, column totals use TJM × estimated days.
- For forfait deals, column totals use fixed price.

Acceptance criteria:

- Dragging a card updates the opportunity stage immediately.
- Column totals update after drag.
- Won/Lost transitions create activity entries.
- Users can filter the board to only régie or only forfait opportunities.

---

### 8.3 Clients directory

**Priority:** P0

The clients page makes client records searchable and scannable.

Requirements:

- Search by client name, industry, location, tags, and notes.
- Filter by industry, size, health, pricing model presence, and open-deal status.
- Toggle table/card views if useful for the existing app layout.
- Sort by name, pipeline value, health, and last activity.
- Show client health and open pipeline value.

Acceptance criteria:

- Search and filters combine correctly.
- Empty state appears when no clients match.
- Row/card click opens `/sales/clients/:id`.

---

### 8.4 Client detail / Client 360

**Priority:** P0

Each client has a detail page showing relationship and deal context.

Requirements:

- Show company information: industry, size, website, location, revenue, owner, tags, notes.
- Show health status and last activity.
- Show people inside the client.
- Show relationship map or equivalent relationship summary.
- Show linked opportunities with régie/forfait pricing labels.
- Show activity timeline and composer.
- Allow adding people and opportunities in context.

Acceptance criteria:

- `/sales/clients/:id` loads the correct client.
- People listed belong to the client.
- Opportunity rows show pricing model and amount.
- Sponsor influence is visible for people linked to open opportunities.

---

### 8.5 People directory

**Priority:** P0

The people page makes contacts searchable across all clients.

Requirements:

- Search by name, role, client, email, notes.
- Filter by client, influence, decision-maker status, and stale contact.
- Highlight champions/sponsors.
- Provide person drawer with contact details and sponsor relationships.
- Allow marking a person as sponsor on relevant opportunities.

Acceptance criteria:

- Search finds people by name, role, or client.
- Sponsor/champion status is visible where relevant.
- Person drawer opens from `/sales/people?focus=<personId>`.

---

### 8.6 Opportunities

**Priority:** P0

The opportunities page supports pipeline review and deal management.

Requirements:

- Show weighted pipeline forecast.
- Show closing-in-30-days and win-rate metrics.
- Show régie versus forfait mix.
- Search opportunities by title, client, owner, sponsor, or pricing model.
- Filter by stage, client, owner, pricing model, amount, close date, and stale status.
- Support grouping by stage, client, owner, or pricing model.
- Open opportunity detail drawer.

Acceptance criteria:

- Search matches sponsor names as well as deal/client fields.
- Table sorting and grouping work with active filters.
- `/sales/opportunities?focus=<opportunityId>` opens the correct drawer.

---

### 8.7 Régie (TJM) and forfait pricing

**Priority:** P0

Opportunities must support two pricing models.

Definitions:

- **Régie**: time-and-materials engagement billed at a TJM (*tarif journalier moyen*) and estimated by number of days.
- **Forfait**: fixed-price engagement.

Requirements:

- Each opportunity has a pricing model: `Régie` or `Forfait`.
- Régie opportunities require:
- TJM / daily rate
- estimated number of days
- estimated value = TJM × estimated days
- Forfait opportunities require:
- fixed price
- Every opportunity has a currency, defaulted from Quicksort operations settings.
- Pipeline amount is derived from pricing model:
- Régie: TJM × estimated days
- Forfait: fixed price
- Weighted forecast uses derived amount × probability.
- Users can filter and group opportunities by pricing model.
- Dashboard and forecast show régie/forfait split.

Acceptance criteria:

- A régie opportunity cannot be saved without TJM and estimated days.
- A forfait opportunity cannot be saved without fixed price.
- Changing TJM or estimated days updates the derived amount.
- Weighted forecast uses the derived amount, not a manually entered amount.

---

### 8.8 Sponsor association

**Priority:** P0

Sponsors are internal champions at the client who help advance an opportunity.

Requirements:

- Associate one or more people to an opportunity as sponsors.
- Track influence per sponsor: Champion, Supporter, Neutral, Blocker.
- Mark one sponsor as primary champion.
- Add/remove sponsors from the opportunity drawer.
- Link additional non-sponsor contacts to an opportunity.
- Log sponsor changes to the opportunity activity timeline.

Acceptance criteria:

- A person can be added as sponsor from the opportunity drawer.
- Influence can be changed inline.
- Primary champion is visually distinct.
- Removing a person removes them from related opportunity sponsor/contact lists.

---

### 8.9 Activity and notes

**Priority:** P1

Sales records should capture ongoing context.

Requirements:

- Log calls, emails, meetings, notes, and stage changes.
- Attach activities to opportunities.
- Show related activity on client and people views where useful.
- Support notes on clients, people, and opportunities.
- Show author and timestamp using the existing operations application user identity.

Acceptance criteria:

- Adding an activity updates the timeline immediately.
- Stage changes automatically create activity entries.
- Notes are saved with author and timestamp.

---

### 8.10 Sales search

**Priority:** P0

The module must be searchable.

Requirements:

- Search clients, people, and opportunities.
- Search by name, role, client, owner, sponsor, stage, pricing model, notes, and tags.
- Group results by entity type.
- Show useful subtitles: client industry, person role/client, opportunity client/stage/amount/pricing model.
- Selecting a result navigates to the correct record or drawer.

Acceptance criteria:

- Search returns clients, people, and opportunities in grouped results.
- Search can find régie and forfait opportunities by pricing model.
- Search results respect existing operations app permissions.

---

## 9. Data Model

Conceptual model only; implementation should map to the existing operations application data layer.

### Client

| Field | Description |
| --- | --- |
| id | Unique client identifier |
| name | Client company name |
| industry | Industry or sector |
| size | Company size bucket |
| website | Client website |
| location | Main location |
| revenue | Optional revenue label or amount |
| tags | Flexible labels |
| health | good / warning / risk |
| owner | Internal owner from operations app users |
| notes | Free-text notes |
| lastActivity | Last recorded activity timestamp |

### Person

| Field | Description |
| --- | --- |
| id | Unique person identifier |
| name | Contact name |
| role | Role inside the client |
| clientId | Related client |
| email | Email address |
| phone | Phone number |
| linkedin | Optional LinkedIn URL |
| isDecisionMaker | Whether the person is a decision-maker |
| notes | Free-text notes |
| lastContact | Last contact timestamp |

### Opportunity

| Field | Description |
| --- | --- |
| id | Unique opportunity identifier |
| title | Opportunity name |
| clientId | Related client |
| pricingModel | Régie or Forfait |
| currency | Currency code, defaulted from operations settings |
| tjm | Daily rate; required for Régie |
| estimatedDays | Required for Régie |
| fixedPrice | Required for Forfait |
| amount | Derived: Régie = tjm × estimatedDays; Forfait = fixedPrice |
| stage | lead / qualified / meeting / proposal / negotiation / won / lost |
| probability | 0–100 |
| expectedClose | Expected close date |
| owner | Internal owner from operations app users |
| createdAt | Creation timestamp |
| sponsorIds | People marked as sponsors/champions |
| contactIds | Other related people |
| sponsorInfluence | Influence per sponsor |
| notes | Free-text notes |

### Activity

| Field | Description |
| --- | --- |
| id | Unique activity identifier |
| opportunityId | Related opportunity |
| type | call / email / meeting / note / stage-change |
| text | Activity description |
| date | Activity timestamp |
| author | Operations app user |

Relationship rules:

- A client has many people.
- A client has many opportunities.
- An opportunity belongs to one client.
- An opportunity can have many sponsors and related contacts.
- A person can sponsor multiple opportunities.
- One sponsor can be marked as the primary champion.

---

## 10. UX and Design Requirements

- Match the existing Quicksort operations application design system.
- Pipeline stages use consistent colors across dashboard, kanban, tables, and badges.
- Sponsor influence uses consistent labels and colors:
- Champion
- Supporter
- Neutral
- Blocker
- Régie and forfait opportunities are clearly labeled anywhere amounts appear.
- Derived amounts are formatted consistently using the operations app currency and number formatting.
- Interactive elements have visible focus states.
- Tables collapse gracefully on smaller screens.
- Kanban remains usable on tablet and mobile, even if drag-and-drop is replaced by a move-to-stage action.

---

## 11. Permissions and Visibility

Use existing operations application permissions.

Recommended rules:

- Users with sales access can view sales records.
- Opportunity owners can edit their opportunities.
- Sales managers can edit all opportunities.
- People and client records inherit visibility from the operations application.
- Restricted clients or contacts remain excluded from search results for unauthorized users.

---

## 12. Reporting and Success Metrics

### First-release success criteria

- Users can find any client, person, or opportunity through sales search.
- Users can move an opportunity through the pipeline.
- Users can tell whether an opportunity is régie or forfait without opening it.
- Users can associate a sponsor to an opportunity and set influence.
- Users can identify stale deals and upcoming closes from the dashboard.

### Ongoing metrics

- Weekly active sales users.
- Opportunities updated per week.
- Percentage of open opportunities with at least one sponsor.
- Percentage of opportunities with a primary champion.
- Average days in stage.
- Win rate by stage and pricing model.
- Pipeline value split: régie versus forfait.
- Forecast accuracy versus closed-won value.

---

## 13. Risks and Limitations

- Régie estimates may change during delivery; the sales module stores estimated value, not delivery actuals.
- Forfait deals may hide effort risk; future versions may add expected effort or margin fields.
- Sponsor model assumes sponsors are people inside the client organization.
- Search must respect existing permissions or it may leak restricted client names.
- If operations app user roles are not granular enough, sales editing rules may need refinement.

---

## 14. Future Roadmap

### Phase 2 — Operational handoff

- Link won opportunities to delivery projects.
- Create project drafts from won régie/forfait deals.
- Sync expected close and start dates with staffing views.

### Phase 3 — Relationship intelligence

- Relationship strength scoring.
- Recommended next actions.
- Sponsor coverage warnings for high-value deals.
- Stakeholder change alerts.

### Phase 4 — Forecasting and margin

- Forecast categories.
- Weighted pipeline by owner, stage, and pricing model.
- Expected delivery days for régie pipeline.
- Margin estimate for forfait deals.
- Historical win/loss analysis.
