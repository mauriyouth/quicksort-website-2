import { test, expect, type Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
const contractId = "22222222-2222-4222-8222-222222222222";
async function mock(page: Page, role = "admin") {
  const now = new Date().toISOString();
  const user = {
    id: userId,
    email: "test@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Alex Morgan" },
    created_at: now,
    email_confirmed_at: now,
  };
  const jwt =
    [
      { alg: "HS256", typ: "JWT" },
      {
        sub: userId,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    ]
      .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
      .join(".") + ".test";
  const state: any = {
    jobs: [],
    profiles: [
      {
        id: userId,
        email: user.email,
        full_name: "Alex Morgan",
        created_at: now,
      },
    ],
    user_roles: [{ user_id: userId, role }],
    contracts: [
      {
        id: contractId,
        candidate_id: userId,
        title: "Employment agreement",
        storage_path: `${userId}/contract.pdf`,
        document_sha256: "a".repeat(64),
        created_at: now,
      },
    ],
    candidate_documents: [],
    tool_requests: [],
    contract_signatures: [],
  };
  await page.route(
    "https://kupbvrnjppcwqxmzxasi.supabase.co/**",
    async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method();
      let body: any;
      try {
        body = request.postDataJSON();
      } catch {}
      const reply = (data: any, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      if (url.pathname.includes("/auth/v1/token"))
        return reply({
          access_token: jwt,
          refresh_token: "test-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user,
        });
      if (url.pathname.includes("/auth/v1/user")) return reply(user);
      if (url.pathname.includes("/auth/")) return reply({});
      if (url.pathname.includes("/storage/")) {
        if (method === "GET")
          return route.fulfill({
            contentType: "application/pdf",
            body: "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
          });
        return reply({ Key: "uploaded", Id: "uploaded" });
      }
      const table = url.pathname.split("/").pop()!;
      if (!state[table]) return reply([]);
      const id = url.searchParams.get("id")?.replace("eq.", "");
      if (method === "POST") {
        const row = { id: crypto.randomUUID(), created_at: now, ...body };
        if (table === "contract_signatures")
          Object.assign(row, {
            candidate_id: userId,
            signed_at: now,
            document_sha256: "a".repeat(64),
            consent_text:
              "I have read this contract and agree to sign it electronically.",
          });
        if (table === "tool_requests")
          Object.assign(row, {
            candidate_id: userId,
            status: "pending",
            admin_note: "",
          });
        state[table].unshift(row);
        return reply(
          request.headers()["accept"]?.includes("object") ? row : [row],
        );
      }
      if (method === "PATCH") {
        const rows = state[table].filter((r: any) => !id || r.id === id);
        rows.forEach((r: any) => Object.assign(r, body));
        return reply(
          request.headers()["accept"]?.includes("object") ? rows[0] : rows,
        );
      }
      if (method === "DELETE") {
        const rows = state[table].filter((r: any) => r.id === id);
        state[table] = state[table].filter((r: any) => r.id !== id);
        return reply(
          request.headers()["accept"]?.includes("object") ? rows[0] : rows,
        );
      }
      let rows = state[table];
      if (url.searchParams.get("published") === "eq.true")
        rows = rows.filter((r: any) => r.published);
      return reply(
        request.headers()["accept"]?.includes("object") ? rows[0] : rows,
      );
    },
  );
  return state;
}
async function login(page: Page, port: number) {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel("Email address").fill("test@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("testing-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("admin creates, publishes, edits and deletes a job", async ({ page }) => {
  const state = await mock(page);
  await login(page, 5174);
  await expect(
    page.getByRole("heading", { name: "Good people. Great work." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/admin-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create a job", exact: true }).click();
  await page.getByLabel("Job title").fill("AI Engineer");
  await page.getByLabel("URL slug").fill("ai-engineer");
  await page
    .getByLabel("Job description")
    .fill("Build reliable AI systems with our Paris team.");
  await page
    .getByLabel("LinkedIn application URL")
    .fill("https://www.linkedin.com/jobs/view/123");
  await page.getByRole("button", { name: "Save job", exact: true }).click();
  await expect(page.getByText("Job saved.", { exact: false })).toBeVisible();
  expect(state.jobs[0].published).toBe(false);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Job published.", { exact: true })).toBeVisible();
  expect(state.jobs[0].published).toBe(true);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Job title").fill("Senior AI Engineer");
  await page.getByRole("button", { name: "Save job", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Senior AI Engineer" }),
  ).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Job deleted.", { exact: true })).toBeVisible();
  expect(state.jobs).toHaveLength(0);
});
test("candidate uploads, signs, downloads and requests access", async ({
  page,
}) => {
  const state = await mock(page, "candidate");
  await login(page, 5175);
  await expect(
    page.getByRole("heading", { name: "Welcome, Alex." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/candidate-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "My documents", exact: true }).click();
  await page
    .getByLabel("Choose a file")
    .setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF"),
    });
  await page
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "resume.pdf" })).toBeVisible();
  expect(state.candidate_documents[0].candidate_id).toBe(userId);
  await page.getByRole("button", { name: "My contracts", exact: true }).click();
  await page
    .getByRole("button", { name: "Review & sign", exact: true })
    .click();
  await page.getByLabel("Your full legal name").fill("Alex Morgan");
  await page.getByLabel("I have read this contract").check();
  await page
    .getByRole("button", { name: "Sign this contract", exact: true })
    .click();
  await expect(
    page.getByText("Your signature has been recorded.", { exact: false }),
  ).toBeVisible();
  expect(state.contract_signatures[0].contract_id).toBe(contractId);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("Employment agreement.pdf");
  await page.getByRole("button", { name: "Tool access", exact: true }).click();
  await page.getByLabel("Tool or service").fill("GitHub");
  await page
    .getByLabel("What do you need it for?")
    .fill("Repository access for onboarding.");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "GitHub", exact: true }),
  ).toBeVisible();
  expect(state.tool_requests[0].status).toBe("pending");
});
test("candidate cannot open admin workspace", async ({ page }) => {
  await mock(page, "candidate");
  await login(page, 5174);
  await expect(
    page.getByRole("heading", { name: "Account created" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Job posts", exact: true }),
  ).toHaveCount(0);
});
test("password confirmation is validated and mobile login fits", async ({
  page,
}) => {
  await mock(page, "candidate");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5175");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).fill("Alex Morgan");
  await page.getByLabel("Email address").fill("alex@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("long-password-123");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/candidate-mobile.png",
    fullPage: true,
  });
});
test("website renders live jobs and removes unpublished posts", async ({
  page,
}) => {
  const state = await mock(page);
  state.jobs = [
    {
      id: "job",
      slug: "ai-engineer",
      title: "AI Engineer",
      department: "Engineering",
      location: "Paris",
      employment_type: "CDI",
      description: "Build useful AI.",
      linkedin_url: "https://www.linkedin.com/jobs/view/123",
      published: true,
    },
  ];
  await page.goto("http://127.0.0.1:5173/career/ai-engineer");
  await expect(
    page.getByRole("heading", { name: "AI Engineer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Apply on LinkedIn" }),
  ).toHaveAttribute("href", "https://www.linkedin.com/jobs/view/123");
  state.jobs[0].published = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "This role is no longer available" }),
  ).toBeVisible();
});
