// Sample data for the local preview and tests. Fictional person and company.
export const DEMO_CV = `# Alex Example

Analytics lead with 9 years in e-commerce and fintech.

## Experience
**Head of Analytics, ShopCo** (2021 - now)
- Lead a team of 7 analysts and data scientists; hired 4 of them.
- Built the analytics strategy and KPI framework with the C-level team.
- Moved reporting from Excel to dbt, Snowflake and Power BI; 60 dashboards retired.
- Ran 40+ A/B tests a year on checkout; +3.1% conversion.

**Senior Data Scientist, PayFast** (2017 - 2021)
- Built churn and forecasting models in Python and SQL.
- Stakeholder management with product and finance teams.

## Skills
Python, SQL, dbt, Snowflake, Power BI, experimentation, forecasting, team leadership, stakeholder management.
English (fluent), Dutch (B1).`;

export const DEMO_JOB = {
  title: "Lead Data Analytics",
  company: "Fieldnote",
  location: "Amsterdam (hybrid)",
  url: "https://example.com/jobs/lead-data-analytics",
  description: `About the role
You will lead our analytics team of 6 and own the analytics strategy.

What you will do
- Lead and grow a team of analysts and analytics engineers.
- Own the KPI framework and work with senior leadership on priorities.
- Set up experimentation across product teams.

What you bring
- 8+ years in analytics, at least 3 years leading a team.
- Strong SQL and Python; experience with dbt and a cloud warehouse (BigQuery or Snowflake).
- Experience with causal inference beyond A/B testing.
- You must speak Dutch fluently.
- Nice to have: Looker, GCP.`,
};

export async function seedDemo(worker, env) {
  const was = env.OPEN_ACCESS;
  env.OPEN_ACCESS = "true"; // seed without signing in
  try { return await seed(worker, env); } finally { env.OPEN_ACCESS = was; }
}

async function seed(worker, env) {
  const base = `http://localhost${env.BASE_PATH}/api`;
  const call = async (path, method = "GET", body) => {
    const r = await worker.fetch(new Request(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }), env);
    return r.json();
  };
  const { cv } = await call("/cvs", "POST", { title: "CV - Lead Data Analytics", profile: "Lead Data Analytics", kind: "cv", body: DEMO_CV });
  const { job } = await call("/jobs", "POST", DEMO_JOB);
  await call("/answers", "POST", { question: "Tell me about a time you built and grew a data team.", tags: "team leadership, hiring", body: "At ShopCo I grew the team from 3 to 7. I hired for complementary skills...", rating: 3 });
  await call("/answers", "POST", { question: "Why do you want to work here?", tags: "motivation", body: "I want to build an analytics function from the ground up..." });
  await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id, engine: "heuristic" });
  return { cv, job };
}
