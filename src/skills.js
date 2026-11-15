// Skill vocabulary used by the built-in (no-LLM) engine and by the fact check. Each entry: canonical name,
// group, and the patterns that count as a mention. Patterns are matched case-insensitively on word boundaries
// unless `cs` (case-sensitive) is set. Extend freely; order does not matter.
const S = (name, group, aliases = [], opts = {}) => ({ name, group, aliases: [name, ...aliases], ...opts });

export const SKILLS = [
  // languages and core tools
  S("python", "tool", ["pandas", "numpy", "scikit-learn", "sklearn", "pyspark"]),
  S("sql", "tool", ["postgres", "postgresql", "mysql", "t-sql", "tsql", "bigquery sql"]),
  S("R", "tool", ["tidyverse", "rstudio", "ggplot2"], { cs: true }),
  S("spark", "tool", ["apache spark", "databricks"]),
  S("dbt", "tool", ["data build tool"]),
  S("airflow", "tool", ["apache airflow", "dagster", "prefect"]),
  S("snowflake", "tool"),
  S("bigquery", "tool", ["google bigquery"]),
  S("redshift", "tool"),
  S("aws", "cloud", ["amazon web services", "sagemaker", "s3"]),
  S("azure", "cloud", ["microsoft azure", "azure ml", "synapse"]),
  S("gcp", "cloud", ["google cloud", "vertex ai"]),
  S("docker", "tool", ["kubernetes", "k8s"]),
  S("git", "tool", ["github", "gitlab", "version control"]),
  S("power bi", "bi", ["powerbi", "dax"]),
  S("tableau", "bi"),
  S("looker", "bi", ["lookml", "looker studio"]),
  S("excel", "bi", ["spreadsheets", "vba"]),
  S("javascript", "tool", ["typescript", "node.js", "react"]),
  // methods
  S("machine learning", "method", ["ml", "predictive modelling", "predictive modeling", "supervised learning"]),
  S("deep learning", "method", ["neural networks", "pytorch", "tensorflow", "keras"]),
  S("nlp", "method", ["natural language processing", "text mining"]),
  S("llm", "method", ["large language models", "generative ai", "genai", "gen ai", "prompt engineering", "rag"]),
  S("statistics", "method", ["statistical analysis", "statistical modelling", "statistical modeling", "bayesian", "regression"]),
  S("experimentation", "method", ["a/b testing", "ab testing", "a/b tests", "controlled experiments", "experiment design"]),
  S("causal inference", "method", ["causal analysis", "uplift modelling", "uplift modeling", "difference-in-differences"]),
  S("forecasting", "method", ["time series", "demand forecasting"]),
  S("optimisation", "method", ["optimization", "operations research", "linear programming"]),
  S("data modelling", "method", ["data modeling", "dimensional modelling", "dimensional modeling", "star schema", "data warehouse", "data warehousing"]),
  S("data engineering", "method", ["etl", "elt", "data pipelines", "data pipeline"]),
  S("mlops", "method", ["model deployment", "model monitoring", "ml ops"]),
  S("data visualisation", "method", ["data visualization", "dashboards", "dashboarding", "reporting"]),
  S("data governance", "method", ["data quality", "data management", "gdpr", "data privacy"]),
  S("product analytics", "method", ["product metrics", "funnel analysis", "user analytics", "amplitude", "mixpanel"]),
  S("segmentation", "method", ["customer segmentation", "clustering"]),
  S("pricing", "method", ["price optimisation", "price optimization", "revenue management"]),
  // product and business
  S("product management", "product", ["product owner", "product roadmap", "roadmapping", "product discovery"]),
  S("agile", "product", ["scrum", "kanban", "sprint"]),
  S("okrs", "product", ["okr", "kpis", "kpi", "north star metric"]),
  S("business case", "business", ["roi", "business value", "commercial impact"]),
  S("strategy", "business", ["data strategy", "analytics strategy", "strategic planning"]),
  S("sustainability", "business", ["esg", "csrd", "carbon accounting"]),
  S("e-commerce", "business", ["ecommerce", "retail"]),
  S("finance", "business", ["fintech", "banking", "risk modelling", "risk modeling"]),
  // leadership and people
  S("team leadership", "leadership", ["people management", "line management", "managing a team", "lead a team", "leading a team", "team lead", "direct reports"]),
  S("hiring", "leadership", ["hired", "recruiting", "recruitment", "talent acquisition", "build a team", "building teams"]),
  S("mentoring", "leadership", ["coaching", "mentorship"]),
  S("stakeholder management", "leadership", ["stakeholders", "stakeholder engagement", "c-level", "executive communication", "senior leadership"]),
  S("communication", "soft", ["storytelling", "presentation skills", "presenting"]),
  S("cross-functional collaboration", "soft", ["cross-functional", "cross functional"]),
  S("change management", "leadership", ["data literacy", "adoption", "data culture"]),
  // languages
  S("dutch", "language", ["nederlands"]),
  S("english", "language"),
  S("german", "language", ["deutsch"]),
  S("french", "language"),
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = SKILLS.map((s) => ({
  ...s,
  re: new RegExp(`(?<![\\w+#&/-])(?:${s.aliases.map(esc).join("|")})(?![\\w+#&-])`, s.cs ? "g" : "gi"),
}));

/** Map canonical skill -> number of mentions in text. */
export function findSkills(text) {
  const out = new Map();
  if (!text) return out;
  for (const s of compiled) {
    s.re.lastIndex = 0;
    const m = text.match(s.re);
    if (m) out.set(s.name, m.length);
  }
  return out;
}

export const skillGroup = (name) => SKILLS.find((s) => s.name === name)?.group ?? "other";

const UPPER = { sql: "SQL", dbt: "dbt", aws: "AWS", gcp: "GCP", nlp: "NLP", llm: "LLMs", okrs: "OKRs", mlops: "MLOps", bigquery: "BigQuery", "power bi": "Power BI", javascript: "JavaScript", R: "R", git: "Git", "e-commerce": "e-commerce" };
/** Display form of a canonical skill name: brands and tools capitalised, methods kept lower case for sentences. */
export const displayName = (name) => {
  if (UPPER[name]) return UPPER[name];
  return ["tool", "cloud", "bi", "language"].includes(skillGroup(name)) ? name[0].toUpperCase() + name.slice(1) : name;
};
/** Title Case for lists and headings (keeps brand spellings such as dbt and SQL). */
export const titleName = (name) => UPPER[name] ?? name.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
