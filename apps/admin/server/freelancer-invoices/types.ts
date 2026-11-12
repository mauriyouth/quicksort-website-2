// Domain view (camelCase) of public.freelancer_invoices and the inputs of the CRA check.
export type FreelancerInvoice = {
  id: string;
  employeeId: string;
  number: string;
  issueDate: string | null;
  periodMonth: string | null;
  dueDate: string | null;
  amountHtCents: number | null;
  vatCents: number | null;
  amountTtcCents: number | null;
  isCreditNote: boolean;
  flags: string[];
  review: "to_check" | "ok" | "rejected";
  reviewNote: string;
  paidAt: string | null;
  paidByTransactionId: string | null;
  source: "portal" | "email";
  createdAt: string;
};

// One cra_entries row (status: rtt | unpaid_leave | paid_leave | internal | client_project).
export type CraDay = {
  day: string;
  part: "full" | "am" | "pm";
  status: string;
  projectId: string | null;
};

// One employee_salaries row (end_date null = current interval).
export type RateRow = {
  dailyRate: number | null;
  startDate: string;
  endDate: string | null;
  rateKind: "daily" | "monthly";
};
