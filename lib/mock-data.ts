import type { RiskLevel } from "@/components/score-card"

export type ScoreOutput = {
  label: string
  value: number
  status: string
  risk: RiskLevel
  detail: string
  trend?: "up" | "down" | "flat"
}

export type TrialBalanceAccount = {
  id: string
  accountName: string
  debit: number
  credit: number
}

export type MappingConfidence = "High" | "Medium" | "Low"

export type AccountMapping = {
  id: string
  accountName: string
  category: string
  confidence: MappingConfidence
  rationale: string
}

export const profileOptions = {
  countries: ["United Arab Emirates", "Saudi Arabia", "Qatar", "Oman", "Bahrain", "Kuwait"],
  emirates: ["Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Ajman", "Fujairah", "Umm Al Quwain"],
  industryFamilies: ["Trading", "Services", "Manufacturing", "Technology", "Real Estate", "Hospitality", "Healthcare"],
  businessActivities: [
    "B2B professional services",
    "Software and digital services",
    "Wholesale trading",
    "Food and beverage operations",
    "Light manufacturing",
    "Real estate management",
  ],
  revenueBands: ["Under AED 1M", "AED 1M - 5M", "AED 5M - 20M", "AED 20M - 100M", "AED 100M+"],
  employeeBands: ["1 - 5", "6 - 25", "26 - 100", "101 - 250", "250+"],
  licenseTypes: ["Mainland", "Free zone", "Offshore"],
  licenseAuthorities: ["DED", "DMCC", "IFZA", "RAKEZ", "SHAMS", "Meydan", "ADGM", "DIFC", "JAFZA"],
  financialRecords: ["Trial Balance", "Financial Statements", "Both"],
  objectives: [
    "Business Performance",
    "Corporate Tax Assessment",
    "Audit Readiness",
    "Funding Readiness",
    "Investor Readiness",
    "Business Valuation",
    "Growth Planning",
    "Compliance Review",
  ],
}

export const landingFeatures = [
  {
    title: "Business Health Score",
    description: "A rules-based score across liquidity, profitability, leverage, compliance, and growth signals.",
  },
  {
    title: "Corporate Tax Readiness",
    description: "Highlights registration status, taxable profit indicators, related-party exposure, and documentation gaps.",
  },
  {
    title: "Audit Readiness",
    description: "Flags accounting quality, balance risks, supporting schedule gaps, and high-review accounts.",
  },
  {
    title: "Industry Benchmarking",
    description: "Compares margins, ratios, and growth indicators against admin-managed benchmark data.",
  },
  {
    title: "Funding Readiness",
    description: "Summarizes lender-facing strengths, working capital gaps, and financial statement readiness.",
  },
  {
    title: "AI CFO Report",
    description: "Uses calculated system outputs to draft plain-English CFO commentary and action plans.",
  },
]

export const sampleCompanyProfile = {
  companyName: "Noura Digital Trading LLC",
  country: "United Arab Emirates",
  emirate: "Dubai",
  industryFamily: "Trading",
  businessActivity: "Wholesale trading",
  companyAge: "4 years",
  revenueBand: "AED 5M - 20M",
  employeeBand: "26 - 100",
  licenseType: "Mainland",
  licenseAuthority: "DED",
  vatRegistered: true,
  corporateTaxRegistered: true,
  auditRequired: true,
  financialRecords: "Both",
  primaryObjective: "Business Performance",
}

export const scoreCards: ScoreOutput[] = [
  {
    label: "Business Health Score",
    value: 82,
    status: "Strong operating base",
    risk: "Low",
    detail: "Healthy gross margin, positive cash conversion, and manageable liabilities.",
    trend: "up",
  },
  {
    label: "Corporate Tax Readiness",
    value: 74,
    status: "Review required",
    risk: "Medium",
    detail: "Tax registration is present, but related-party and expense add-back documentation need review.",
    trend: "flat",
  },
  {
    label: "Audit Readiness",
    value: 68,
    status: "Preparation needed",
    risk: "Medium",
    detail: "Receivables aging, inventory support, and revenue cut-off evidence should be strengthened.",
    trend: "down",
  },
  {
    label: "Compliance Readiness",
    value: 78,
    status: "Mostly ready",
    risk: "Medium",
    detail: "VAT and CT profiles are aligned, with UBO and record retention review still open.",
    trend: "up",
  },
  {
    label: "Funding Readiness",
    value: 71,
    status: "Bankable with cleanup",
    risk: "Medium",
    detail: "Cash flow is stable, but management accounts need clearer monthly comparatives.",
    trend: "flat",
  },
  {
    label: "Investor Readiness",
    value: 76,
    status: "Narrative ready",
    risk: "Low",
    detail: "Growth, margin expansion, and customer concentration should be packaged for diligence.",
    trend: "up",
  },
]

export const recentAssessments = [
  { id: "FS-2026-014", company: "Noura Digital Trading LLC", date: "2026-06-14", status: "Report ready", score: 82 },
  { id: "FS-2026-013", company: "Al Dana Services FZCO", date: "2026-06-09", status: "Mapping review", score: 69 },
  { id: "FS-2026-012", company: "Harbor Retail LLC", date: "2026-06-02", status: "Expert review", score: 73 },
]

export const topRisks = [
  "Low-confidence mapping on director-related balances.",
  "Receivables days are above the industry midpoint.",
  "Entertainment and management fee accounts need tax treatment review.",
]

export const topOpportunities = [
  "Gross margin is 4.1 points above benchmark and can support pricing confidence.",
  "Operating expense ratio is trending down for the second quarter.",
  "Inventory days suggest AED 340K potential working-capital release.",
]

export const regulatoryCards = [
  {
    title: "VAT",
    status: "Registered",
    relevance: "High",
    detail: "VAT profile is active. Review input tax recovery, zero-rated supplies, and reverse charge indicators.",
  },
  {
    title: "Corporate Tax",
    status: "Registered",
    relevance: "High",
    detail: "Corporate Tax registration is present. Estimated taxable position and add-back categories require review.",
  },
  {
    title: "QFZP Considerations",
    status: "Not primary",
    relevance: "Medium",
    detail: "Mainland DED profile lowers QFZP relevance, but free-zone transactions should still be tagged.",
  },
  {
    title: "Transfer Pricing",
    status: "Watch",
    relevance: "Medium",
    detail: "Related-party, management fee, and director balance indicators should be documented.",
  },
  {
    title: "UBO",
    status: "Maintain",
    relevance: "Medium",
    detail: "Keep ultimate beneficial owner records current with license authority files.",
  },
  {
    title: "AML",
    status: "Awareness",
    relevance: "Medium",
    detail: "Trading activity should maintain customer due diligence and unusual transaction records.",
  },
  {
    title: "Audit Requirements",
    status: "Required",
    relevance: "High",
    detail: "Audit readiness is relevant based on profile and scale. Supporting schedules are recommended.",
  },
  {
    title: "Record Keeping",
    status: "Required",
    relevance: "High",
    detail: "Maintain accounting records, tax invoices, contracts, and reconciliations for statutory retention periods.",
  },
]

export const trialBalanceAccounts: TrialBalanceAccount[] = [
  { id: "1000", accountName: "Bank - Emirates NBD Operating", debit: 980000, credit: 0 },
  { id: "1100", accountName: "Trade Receivables", debit: 1420000, credit: 0 },
  { id: "1200", accountName: "Inventory - Finished Goods", debit: 870000, credit: 0 },
  { id: "1500", accountName: "Property and Equipment", debit: 720000, credit: 0 },
  { id: "2000", accountName: "Trade Payables", debit: 0, credit: 760000 },
  { id: "2200", accountName: "VAT Payable", debit: 0, credit: 118000 },
  { id: "2300", accountName: "Bank Loan - Current Portion", debit: 0, credit: 410000 },
  { id: "3000", accountName: "Share Capital", debit: 0, credit: 300000 },
  { id: "3100", accountName: "Retained Earnings", debit: 0, credit: 1296000 },
  { id: "4000", accountName: "Sales Revenue", debit: 0, credit: 8750000 },
  { id: "5000", accountName: "Cost of Sales", debit: 5075000, credit: 0 },
  { id: "6000", accountName: "Salaries and Wages", debit: 1120000, credit: 0 },
  { id: "6100", accountName: "Rent Expense", debit: 410000, credit: 0 },
  { id: "6200", accountName: "Marketing Expense", debit: 235000, credit: 0 },
  { id: "6300", accountName: "Entertainment Expense", debit: 86000, credit: 0 },
  { id: "6400", accountName: "Management Fees - Related Party", debit: 260000, credit: 0 },
  { id: "7000", accountName: "Finance Costs", debit: 93000, credit: 0 },
  { id: "8000", accountName: "Other Income", debit: 0, credit: 45000 },
]

export const mappingCategories = [
  "Revenue",
  "Cost of Sales",
  "Operating Expenses",
  "Finance Costs",
  "Other Income",
  "Current Assets",
  "Non-Current Assets",
  "Current Liabilities",
  "Non-Current Liabilities",
  "Equity",
  "Tax Accounts",
  "Related Party Accounts",
]

export const accountMappings: AccountMapping[] = [
  { id: "m1", accountName: "Sales Revenue", category: "Revenue", confidence: "High", rationale: "Revenue keyword and credit balance." },
  { id: "m2", accountName: "Cost of Sales", category: "Cost of Sales", confidence: "High", rationale: "Cost account aligned to trading activity." },
  { id: "m3", accountName: "VAT Payable", category: "Tax Accounts", confidence: "High", rationale: "VAT liability account detected." },
  { id: "m4", accountName: "Entertainment Expense", category: "Operating Expenses", confidence: "Medium", rationale: "Expense account with potential tax treatment review." },
  { id: "m5", accountName: "Management Fees - Related Party", category: "Related Party Accounts", confidence: "Low", rationale: "Related-party keyword requires user confirmation." },
  { id: "m6", accountName: "Bank Loan - Current Portion", category: "Current Liabilities", confidence: "Medium", rationale: "Current portion wording suggests short-term classification." },
]

export const processingSteps = [
  "Financial Statement Preparation",
  "KPI Analysis",
  "Industry Benchmarking",
  "Tax Assessment",
  "Audit Assessment",
  "Report Generation",
]

export const benchmarkRows = [
  { metric: "Gross margin", company: 42, industry: 38 },
  { metric: "Net margin", company: 17, industry: 14 },
  { metric: "Current ratio", company: 1.72, industry: 1.48 },
  { metric: "Receivable days", company: 59, industry: 46 },
]

export const growthRows = [
  { period: "Q1", industry: 5.5, company: 6.1 },
  { period: "Q2", industry: 6.2, company: 7.4 },
  { period: "Q3", industry: 6.8, company: 8.2 },
  { period: "Q4", industry: 7.1, company: 8.9 },
]

export const performanceGaps = [
  { label: "Gross margin gap", value: "+4.1 pts", tone: "Positive" },
  { label: "Net margin gap", value: "+2.8 pts", tone: "Positive" },
  { label: "Current ratio gap", value: "+0.24x", tone: "Positive" },
  { label: "Receivable days gap", value: "+13 days", tone: "Watch" },
]

export const financialStatements = [
  {
    title: "Profit & Loss",
    rows: [
      { label: "Revenue", current: 8750000, prior: 7420000 },
      { label: "Cost of Sales", current: -5075000, prior: -4480000 },
      { label: "Gross Profit", current: 3675000, prior: 2940000 },
      { label: "Operating Expenses", current: -2111000, prior: -1930000 },
      { label: "Finance Costs", current: -93000, prior: -81000 },
      { label: "Profit Before Tax", current: 1471000, prior: 929000 },
    ],
  },
  {
    title: "Balance Sheet",
    rows: [
      { label: "Current Assets", current: 3270000, prior: 2810000 },
      { label: "Non-Current Assets", current: 720000, prior: 760000 },
      { label: "Current Liabilities", current: -1288000, prior: -1190000 },
      { label: "Non-Current Liabilities", current: -610000, prior: -790000 },
      { label: "Equity", current: -2092000, prior: -1590000 },
    ],
  },
  {
    title: "Cash Flow Statement",
    rows: [
      { label: "Operating Cash Flow", current: 980000, prior: 650000 },
      { label: "Investing Cash Flow", current: -165000, prior: -210000 },
      { label: "Financing Cash Flow", current: -220000, prior: 120000 },
      { label: "Net Movement in Cash", current: 595000, prior: 560000 },
    ],
  },
  {
    title: "Statement of Changes in Equity",
    rows: [
      { label: "Opening Equity", current: 1590000, prior: 1020000 },
      { label: "Profit for the Period", current: 1471000, prior: 929000 },
      { label: "Dividends / Drawings", current: -969000, prior: -359000 },
      { label: "Closing Equity", current: 2092000, prior: 1590000 },
    ],
  },
]

export const notesToFinancialStatements = [
  "Revenue is presented from uploaded trial balance accounts mapped to standardized categories.",
  "VAT, Corporate Tax, and audit outputs are indicative and require professional review.",
  "Cash flow statement uses placeholder indirect-method logic pending live bank and ledger integrations.",
  "Related-party accounts are highlighted for management confirmation before final reporting.",
]

export const cfoReportSections = [
  {
    title: "Executive Summary",
    bullets: [
      "Bayani calculates a strong Business Health Score of 82 based on margin strength, liquidity, and cash conversion.",
      "The entity appears commercially healthy, with tax and audit readiness requiring targeted documentation review.",
      "All commentary is indicative, requires professional review, and is not professional advice.",
    ],
  },
  {
    title: "Strengths",
    bullets: ["Gross margin exceeds benchmark.", "Cash movement is positive.", "Debt servicing pressure is manageable."],
  },
  {
    title: "Weaknesses",
    bullets: ["Receivable days exceed benchmark.", "Related-party account support is incomplete.", "Monthly management reporting can be clearer."],
  },
  {
    title: "Risks",
    bullets: ["Expense tax treatment review is required.", "Audit evidence for inventory and receivables needs strengthening.", "Transfer pricing indicators need documentation."],
  },
  {
    title: "Growth Opportunities",
    bullets: ["Protect premium pricing where gross margin outperforms peers.", "Release working capital through receivable collection discipline.", "Package benchmark outperformance for lender and investor discussions."],
  },
  {
    title: "90-Day Action Plan",
    bullets: ["Confirm low-confidence mappings.", "Prepare receivable aging and inventory support.", "Create tax add-back schedule and related-party file.", "Finalize PDF report for expert review."],
  },
]

export const vatIntelligence = [
  { label: "Estimated VAT Position", value: "AED 118K payable", detail: "System-calculated from mapped VAT control account." },
  { label: "VAT Risk Assessment", value: "Medium", detail: "Input recovery and reverse-charge indicators need review." },
  { label: "Potential Registration Review", value: "Registered", detail: "Profile shows VAT registered; TRN evidence should be stored." },
  { label: "Potential Input VAT Areas", value: "Rent, marketing, professional fees", detail: "Recoverability depends on invoice and supply rules." },
  { label: "Potential Output VAT Areas", value: "Domestic taxable sales", detail: "Sales mapping suggests standard taxable output VAT exposure." },
  { label: "Potential Reverse Charge Indicators", value: "Possible imports/services", detail: "Supplier origin should be tagged in live ledger integration." },
]

export const corporateTaxIndicators = [
  "Related Party Transactions",
  "Management Fees",
  "Entertainment Expenses",
  "Transfer Pricing Indicators",
  "QFZP Considerations",
]

export const corporateTaxItems = [
  { label: "Corporate Tax Readiness Score", value: "74 / 100" },
  { label: "Estimated Tax Position", value: "Profit before tax AED 1.47M before professional adjustments." },
  { label: "Potential Tax Risks", value: "Entertainment expense treatment, related-party pricing, and unsupported provisions." },
  { label: "Potential Tax Opportunities", value: "Document deductible expenses and reconcile taxable income adjustments early." },
]

export const auditFindings = [
  "Receivables aging and expected credit loss assessment should be prepared.",
  "Inventory count evidence and slow-moving stock review should be attached.",
  "Related-party management fee agreements should be reconciled to ledger postings.",
  "Revenue recognition cut-off should be tested around period end.",
  "Bank reconciliations and approval controls should be retained.",
]

export const valuationMethods = [
  { label: "Revenue Multiple Value", value: "AED 10.5M", detail: "Based on indicative 1.2x revenue multiple from benchmark table." },
  { label: "EBITDA Multiple Value", value: "AED 8.8M", detail: "Based on indicative 5.0x normalized EBITDA multiple." },
  { label: "Asset-Based Value", value: "AED 3.4M", detail: "Based on net asset position with placeholder adjustments." },
  { label: "Indicative Business Value Range", value: "AED 7.6M - AED 10.8M", detail: "Requires professional valuation review and market evidence." },
]

export const finalReportSections = [
  "Executive Summary",
  "Financial Statements",
  "Business Health Score",
  "Industry Comparison",
  "VAT Intelligence",
  "Corporate Tax Intelligence",
  "Audit Intelligence",
  "CFO Commentary",
  "Recommendations",
  "Action Plan",
]

export const adminResources = [
  { name: "Users", count: 124, status: "Active" },
  { name: "Industries", count: 18, status: "Configured" },
  { name: "Business Activities", count: 86, status: "Configured" },
  { name: "Benchmarks", count: 312, status: "Needs Q3 refresh" },
  { name: "Scoring Rules", count: 44, status: "Version 1.0" },
  { name: "Intelligence Rules", count: 58, status: "Version 1.0" },
  { name: "Reports", count: 391, status: "Generated" },
  { name: "Leads", count: 27, status: "Open" },
  { name: "Pricing", count: 3, status: "Published" },
]

export const pricingPlans = [
  { name: "Starter", price: "AED 299", detail: "Single assessment, PDF export, basic intelligence." },
  { name: "Growth", price: "AED 799", detail: "Five assessments, benchmarking, expert review workflow." },
  { name: "Enterprise", price: "Custom", detail: "Admin rules, custom benchmarks, Supabase tenant controls." },
]

export const expertReviewServices = [
  "Audit",
  "Corporate Tax Review",
  "VAT Review",
  "Financial Statements",
  "Bookkeeping",
  "CFO Advisory",
  "Business Valuation",
]
