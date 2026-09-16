import { api, apiClient } from '@api/client';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

// `@api/client`, not `./client`: this module moved from `src/api/` into
// `src/features/utilities/api/` and the relative path went stale in the move —
// there is no `client` beside it here.

// Types
export interface UtilityProvider {
  id: string;
  name: string;
  type: 'electricity' | 'gas' | 'garbage' | 'water' | 'sewer';
  service_area: string | null;
  website_url: string | null;
  portal_url: string | null;
  billing_cycle: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
}

export interface UtilityAccount {
  id: string;
  household_id: string;
  provider_id: string;
  account_number: string;
  service_type: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  start_date: string | null;
  is_active: boolean;
  billing_cycle_preference: string | null;
  created_at: string;
  updated_at: string;
}

export interface UtilityBill {
  id: string;
  household_id: string;
  account_id: string | null;
  bill_type: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  provider: string | null;
  account_number: string | null;
  billing_period_start: string;
  billing_period_end: string;
  amount: number; // in cents
  due_date: string;
  paid_date: string | null;
  paid_amount: number | null; // in cents
  usage_quantity: number | null;
  usage_unit: string | null;
  document_url: string | null;
  ai_extracted_data: string | null; // JSON string
  confidence_score: number | null;
  // The one-time "Pay <provider> bill" task auto-created while this bill is
  // unpaid (null once paid or if no task is linked).
  task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyTax {
  id: string;
  household_id: string;
  tax_year: number;
  assessed_value: number; // in cents
  tax_amount: number; // in cents
  advance_payment_amount: number | null;
  advance_payment_due_date: string | null;
  advance_payment_paid_date: string | null;
  main_payment_amount: number;
  main_payment_due_date: string;
  main_payment_paid_date: string | null;
  homeowner_grant_eligible: boolean;
  homeowner_grant_amount: number | null;
  homeowner_grant_applied_date: string | null;
  homeowner_grant_status: 'pending' | 'approved' | 'rejected' | null;
  penalties: string | null; // JSON array
  document_url: string | null;
  // Ids of the reminder tasks auto-created while the tax is unpaid (null once
  // paid / grant applied, or if no task is linked).
  main_payment_task_id: string | null;
  grant_task_id: string | null;
  created_at: string;
  updated_at: string;
  // Only present on the create response: a soft warning that another property
  // already claimed this year's Home Owner Grant (one property per year).
  grantWarning?: string;
}

export interface BCAssessmentData {
  id: string;
  household_id: string;
  assessment_year: number;
  property_class: string | null;
  assessed_value: number; // in cents
  land_value: number | null;
  improvement_value: number | null;
  previous_year_value: number | null;
  change_percent: number | null;
  assessment_pdf_key: string | null;
  appeal_deadline: string | null;
  appeal_filed: boolean;
  created_at: string;
  updated_at: string;
}

export interface MunicipalityConfig {
  id: string;
  municipality_name: string;
  municipality_code: string;
  property_tax_advance_due_date: string | null;
  property_tax_main_due_date: string;
  utility_due_date: string | null;
  early_discount_percentage: number | null;
  penalty_structure: string | null; // JSON
  portal_url: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
}

export type ProviderKey = 'overview' | 'bc_hydro' | 'fortisbc' | 'city_of_surrey' | 'other';

export interface BillInsight {
  id: string;
  severity: 'info' | 'warning' | 'positive';
  title: string;
  body: string;
  providerKey?: ProviderKey;
  billType?: string;
}

export interface ProviderSummary {
  providerKey: ProviderKey;
  label: string;
  totalAmount: number;
  billCount: number;
  latestBillDate: string | null;
  avgMonthlyAmount: number;
  primaryBillType: string;
  usageUnit: string | null;
  totalUsage: number;
}

export interface DashboardOverview {
  upcomingBills: UtilityBill[];
  currentMonthTotal: number;
  prevMonthTotal: number;
  change: number;
  changePercent: number;
  currentMonthByType?: {
    electricity: number;
    gas: number;
    water: number;
  };
  /** YYYY-MM the headline numbers summarize (latest month with activity). */
  periodMonthKey?: string;
  /** Human label for that period — "This month" or e.g. "June 2026". */
  periodLabel?: string;
  /** True when the summarized period is the actual current calendar month. */
  periodIsCurrent?: boolean;
  byProvider?: ProviderSummary[];
  insights?: BillInsight[];
  municipality: MunicipalityConfig | null;
}

export interface MonthlyAnalyticsRow {
  month: string;
  total: number;
  count: number;
  usage: number;
  byType: Record<string, number>;
  byProvider: Record<string, number>;
}

export interface BillAnalytics {
  monthlyData: MonthlyAnalyticsRow[];
  byType: Record<string, { total: number; count: number; average: number }>;
  byProvider: ProviderSummary[];
  insights: BillInsight[];
  totalBills: number;
  totalAmount: number;
  proratedTotalAmount: number;
  yearOverYear: {
    currentYear: { year: number; total: number; count: number };
    previousYear: { year: number; total: number; count: number };
    change: number;
    changePercent: number;
  };
}

// Request types
interface CreateUtilityAccountRequest {
  providerId: string;
  accountNumber: string;
  serviceType: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  startDate?: string;
  billingCyclePreference?: 'monthly' | 'bimonthly' | 'quarterly' | 'annual';
}

interface UpdateUtilityAccountRequest {
  accountNumber?: string;
  isActive?: boolean;
  billingCyclePreference?: 'monthly' | 'bimonthly' | 'quarterly' | 'annual';
}

interface CreateUtilityBillRequest {
  accountId?: string;
  billType: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  provider?: string;
  accountNumber?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amount: number; // in cents
  dueDate: string;
  paidDate?: string;
  paidAmount?: number; // in cents
  usageQuantity?: number;
  usageUnit?: string;
  documentUrl?: string;
  aiExtractedData?: object;
  confidenceScore?: number;
}

interface UpdateUtilityBillRequest {
  billType?: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  provider?: string;
  accountNumber?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  amount?: number;
  dueDate?: string;
  paidDate?: string;
  paidAmount?: number;
  usageQuantity?: number;
  usageUnit?: string;
}

export interface CreatePropertyTaxRequest {
  taxYear: number;
  assessedValue: number; // in cents
  taxAmount: number; // in cents
  advancePaymentAmount?: number;
  advancePaymentDueDate?: string;
  mainPaymentAmount: number;
  mainPaymentDueDate: string;
  homeownerGrantEligible?: boolean;
  homeownerGrantAmount?: number;
  // When true, the grant is claimed now: the backend deducts it from the amount
  // owed, marks the record applied, and skips the "Claim grant" reminder task.
  homeownerGrantApplied?: boolean;
  documentUrl?: string;
  // When set, the tax is recorded as already paid (no reminder tasks created).
  mainPaymentPaidDate?: string;
  // Municipality name from the scanned notice — used in the pay-task title.
  municipalityName?: string;
}

interface UpdatePropertyTaxRequest {
  assessedValue?: number;
  taxAmount?: number;
  advancePaymentPaidDate?: string;
  mainPaymentPaidDate?: string;
  homeownerGrantAppliedDate?: string;
  homeownerGrantStatus?: 'pending' | 'approved' | 'rejected';
}

interface CreateBCAssessmentRequest {
  assessmentYear: number;
  propertyClass?: string;
  assessedValue: number; // in cents
  landValue?: number;
  improvementValue?: number;
  previousYearValue?: number;
  changePercent?: number;
  assessmentPdfKey?: string;
  appealDeadline?: string;
}

interface UpdateBCAssessmentRequest {
  propertyClass?: string;
  assessedValue?: number; // in cents
  landValue?: number;
  improvementValue?: number;
  previousYearValue?: number;
  changePercent?: number;
  appealDeadline?: string;
  appealFiled?: boolean;
}

// Bill extraction types
export interface ExtractedBillData {
  provider: {
    name: string | null;
    type: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  };
  account: {
    number: string | null;
    invoiceNumber?: string | null;
    serviceAddress: string | null;
    customerName: string | null;
  };
  billing: {
    periodStart: string | null;
    periodEnd: string | null;
    billingDate: string | null;
    dueDate: string | null;
  };
  financial: {
    amountDue: number | null;
    previousBalance: number | null;
    paymentsReceived: number | null;
    currentCharges?: number | null;
    latePaymentCharge?: number | null;
  };
  usage: {
    quantity: number | null;
    unit: string | null;
    periodDays: number | null;
    averageDailyUsage: number | null;
    averageDailyCost?: number | null;
    meterNumber: string | null;
  };
  meterReadings?: Array<{
    meterNumber: string | null;
    currentReading: number | null;
    currentReadingDate: string | null;
    previousReading: number | null;
    previousReadingDate: string | null;
    consumption: number | null;
    unit: string | null;
    conversionFactor: number | null;
  }>;
  lineItems?: Array<{
    description: string;
    amount: number;
    quantity: number | null;
    rate: number | null;
    unit: string | null;
  }>;
  taxes?: Array<{ description: string; amount: number }>;
  comparison?: {
    lastBillUsage: number | null;
    lastYearUsage: number | null;
    unit: string | null;
  };
  rates: {
    basicCharge: number | null;
    energyRate: number | null;
  };
  confidence: {
    overall: number;
    provider: number;
    account: number;
    billing: number;
    financial: number;
    usage: number;
  };
  rawText: string;
}

// Property tax extraction types (mirror backend ExtractedPropertyTax)
export interface ExtractedPropertyTaxData {
  municipality: { name: string | null };
  property: {
    address: string | null;
    folioNumber: string | null;
    accessCode: string | null;
    legalDescription: string | null;
    ownerName: string | null;
    propertyClass: string | null;
  };
  taxYear: number | null;
  assessedValue: number | null; // in dollars
  financial: {
    totalTaxAmount: number | null; // in dollars (No-Grant amount due)
    amountWithBasicGrant: number | null;
    amountWithSeniorGrant: number | null;
  };
  payment: {
    mainDueDate: string | null;
    mainAmount: number | null;
    advanceDueDate: string | null;
    advanceAmount: number | null;
  };
  homeownerGrant: {
    eligible: boolean;
    basicAmount: number | null;
    seniorAmount: number | null;
    claimUrl: string | null;
  };
  penalty: {
    description: string | null;
    percentage: number | null;
    afterDate: string | null;
  };
  confidence: {
    overall: number;
    municipality: number;
    taxYear: number;
    financial: number;
    payment: number;
  };
  rawText: string;
}

// The create-ready shape the backend derives from an extraction (amounts already
// in cents). Feeds straight into createPropertyTax after the user reviews it.
export interface SuggestedPropertyTax {
  taxYear: number;
  assessedValue: number; // in cents
  taxAmount: number; // in cents
  mainPaymentAmount: number; // in cents
  mainPaymentDueDate: string;
  advancePaymentAmount?: number; // in cents
  advancePaymentDueDate?: string;
  homeownerGrantEligible: boolean;
  homeownerGrantAmount?: number; // in cents
  municipalityName?: string;
  confidenceScore: number;
}

export interface PropertyTaxUploadResponse {
  success: boolean;
  /** True when a record for this tax year already exists. */
  duplicate?: boolean;
  existingTax?: PropertyTax;
  extractedData: ExtractedPropertyTaxData;
  suggestedTax: SuggestedPropertyTax;
  documentUrl: string;
  confidence: ExtractedPropertyTaxData['confidence'];
  tokensUsed: number;
}

// BC Assessment extraction types (mirror backend ExtractedBCAssessment)
export interface BCAssessmentValueHistoryYear {
  year: number;
  totalValue: number | null; // in dollars
  landValue: number | null;
  improvementValue: number | null;
  exemptValue: number | null;
  netValue: number | null;
  changePercent: number | null;
}

export interface BCAssessmentSale {
  date: string | null; // YYYY-MM-DD
  price: number | null; // in dollars
}

export interface BCAssessmentPropertyInfo {
  yearBuilt: number | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carports: number | null;
  garages: string | null;
  landSizeSqFt: number | null;
  firstFloorAreaSqFt: number | null;
  secondFloorAreaSqFt: number | null;
  basementFinishAreaSqFt: number | null;
  strataAreaSqFt: number | null;
  buildingStoreys: number | null;
  grossLeasableAreaSqFt: number | null;
  netLeasableAreaSqFt: number | null;
  manufacturedHome: boolean | null;
}

export interface BCAssessmentHomeownerGrant {
  basicGrant: number | null; // in dollars
  additionalGrant: number | null;
  grantClaimed: number | null;
}

export interface ExtractedBCAssessmentData {
  assessmentYear: number | null;
  property: {
    address: string | null;
    rollNumber: string | null;
    jurisdiction: string | null;
    jurisdictionNumber: string | null;
    pid: string | null;
    propertyClass: string | null;
    ownerName: string | null;
    owners: string[];
    legalDescription: string | null;
  };
  propertyInfo: BCAssessmentPropertyInfo;
  values: {
    totalValue: number | null; // in dollars
    landValue: number | null;
    improvementValue: number | null;
    previousYearValue: number | null;
  };
  valueHistory: BCAssessmentValueHistoryYear[]; // descending by year
  salesHistory: BCAssessmentSale[];
  homeownerGrant: BCAssessmentHomeownerGrant | null;
  appealDeadline: string | null;
  confidence: {
    overall: number;
    assessmentYear: number;
    values: number;
    property: number;
  };
  rawText: string;
}

// The create-ready shape the backend derives from an assessment extraction
// (amounts already in cents). Feeds into createBCAssessment / updateBCAssessment
// after the user reviews it.
export interface SuggestedBCAssessment {
  assessmentYear: number;
  propertyClass?: string;
  assessedValue: number; // in cents
  landValue?: number; // in cents
  improvementValue?: number; // in cents
  previousYearValue?: number; // in cents
  changePercent?: number;
  appealDeadline?: string;
  confidenceScore: number;
}

export interface BCAssessmentUploadResponse {
  success: boolean;
  /** True when a record for this assessment year already exists. */
  duplicate?: boolean;
  existingAssessment?: BCAssessmentData;
  extractedData: ExtractedBCAssessmentData;
  suggestedAssessment: SuggestedBCAssessment;
  /**
   * Prior years auto-persisted from the notice's multi-year value history
   * (current roll year excluded — it goes through the review sheet).
   */
  historyBackfill?: { created: number; enriched: number };
  /**
   * The notice's most recent sale (highest date) — the best candidate for the
   * owner's real purchase price, offered so the client can one-tap prefill.
   */
  suggestedPurchase?: BCAssessmentSale | null;
  documentUrl: string;
  confidence: ExtractedBCAssessmentData['confidence'];
  tokensUsed: number;
}

// ── Property insights (server-computed for the Property detail screen) ──────
export interface PropertyStatTile {
  id: string;
  label: string;
  value: string; // pre-formatted (e.g. "$1.18M", "0.43%")
  subtitle?: string;
  tone?: 'default' | 'positive' | 'warning';
}

export interface PropertyInsightCard {
  id: string;
  severity: 'info' | 'positive' | 'warning';
  title: string;
  body: string;
}

export interface AssessmentHistoryPoint {
  year: number;
  assessedValue: number; // in cents
  landValue: number | null;
  improvementValue: number | null;
  changePercent: number | null;
}

export interface TaxHistoryPoint {
  year: number;
  taxAmount: number; // in cents
  assessedValue: number; // in cents
  paid: boolean;
  dueDate: string;
}

export interface PropertyInsights {
  hasData: boolean;
  assessment: {
    latest: BCAssessmentData | null;
    history: AssessmentHistoryPoint[]; // ascending by year
    yoy: { changeCents: number; changePercent: number } | null;
    landVsBuilding: { landValue: number; improvementValue: number } | null; // cents
  };
  propertyTax: {
    latest: PropertyTax | null;
    history: TaxHistoryPoint[]; // ascending by year
    yoy: { changeCents: number; changePercent: number } | null;
    nextDue: {
      year: number;
      amount: number; // in cents
      dueDate: string;
      paid: boolean;
      grantEligible: boolean;
      grantApplied: boolean;
    } | null;
  };
  stats: PropertyStatTile[];
  insights: PropertyInsightCard[];
}

export interface BillUploadResponse {
  success: boolean;
  autoCreated: boolean;
  /** True when this bill matches one already saved (month-based detection). */
  duplicate?: boolean;
  /** The existing bill this one duplicates, when `duplicate` is true. */
  existingBill?: UtilityBill;
  bill?: UtilityBill;
  extractedData: ExtractedBillData;
  documentUrl: string;
  confidence: ExtractedBillData['confidence'];
  tokensUsed: number;
  suggestedBill: {
    billType: string;
    provider: string | null;
    accountNumber: string | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    amount: number | null;
    dueDate: string | null;
    usageQuantity: number | null;
    usageUnit: string | null;
  };
}

// API functions
// The axios response interceptor returns the full AxiosResponse, so every
// request must read `.data` to get the parsed body. Missing this unwrap made
// the dashboard read fields off the response object (all undefined → "$NaN"
// and "No bills yet" everywhere). Mirror the savings/budget api modules:
// `apiClient.get<T>(url).then((res) => res.data)`.
const remoteUtilitiesApi = {
  // Municipality
  async getMunicipality(householdId: string): Promise<{ municipality: MunicipalityConfig | null }> {
    const res = await apiClient.get<{ municipality: MunicipalityConfig | null }>(
      `/households/${householdId}/utilities/municipality`
    );
    return res.data;
  },

  // Utility Accounts
  async createAccount(householdId: string, data: CreateUtilityAccountRequest): Promise<UtilityAccount> {
    const res = await apiClient.post<UtilityAccount>(
      `/households/${householdId}/utilities/accounts`,
      data
    );
    return res.data;
  },

  async getAccounts(householdId: string): Promise<UtilityAccount[]> {
    const res = await apiClient.get<UtilityAccount[]>(`/households/${householdId}/utilities/accounts`);
    return res.data;
  },

  async updateAccount(
    householdId: string,
    accountId: string,
    data: UpdateUtilityAccountRequest
  ): Promise<UtilityAccount> {
    const res = await apiClient.patch<UtilityAccount>(
      `/households/${householdId}/utilities/accounts/${accountId}`,
      data
    );
    return res.data;
  },

  async deleteAccount(householdId: string, accountId: string): Promise<void> {
    await apiClient.delete(`/households/${householdId}/utilities/accounts/${accountId}`);
  },

  // Utility Bills
  async createBill(
    householdId: string,
    data: CreateUtilityBillRequest,
    // deferPayTask: skip the immediate "Pay bill" task — used by batch import,
    // where the ConfirmBillPayments step creates tasks for the bills left unpaid.
    options?: { allowDuplicate?: boolean; deferPayTask?: boolean }
  ): Promise<UtilityBill> {
    const body = {
      ...data,
      ...(options?.allowDuplicate ? { allowDuplicate: true } : {}),
      ...(options?.deferPayTask ? { deferPayTask: true } : {}),
    };
    const res = await apiClient.post<UtilityBill>(`/households/${householdId}/utilities/bills`, body);
    return res.data;
  },

  async getBills(
    householdId: string,
    filters?: {
      billType?: string;
      startDate?: string;
      endDate?: string;
      paid?: boolean;
      limit?: number;
    }
  ): Promise<UtilityBill[]> {
    const params = new URLSearchParams();
    if (filters?.billType) params.append('billType', filters.billType);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.paid !== undefined) params.append('paid', filters.paid.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const query = params.toString();
    const res = await apiClient.get<UtilityBill[]>(
      `/households/${householdId}/utilities/bills${query ? `?${query}` : ''}`
    );
    return res.data;
  },

  async updateBill(
    householdId: string,
    billId: string,
    data: UpdateUtilityBillRequest
  ): Promise<UtilityBill> {
    const res = await apiClient.patch<UtilityBill>(
      `/households/${householdId}/utilities/bills/${billId}`,
      data
    );
    return res.data;
  },

  async deleteBill(householdId: string, billId: string): Promise<void> {
    await apiClient.delete(`/households/${householdId}/utilities/bills/${billId}`);
  },

  /**
   * Bulk-confirm paid status for freshly-imported bills (import-review screen).
   * Paid bills get today's date + their own amount and lose their reminder task;
   * unpaid bills keep/regain a "Pay bill" task. Returns the updated bills.
   */
  async setBillsPaidStatus(
    householdId: string,
    updates: Array<{ billId: string; paid: boolean }>
  ): Promise<UtilityBill[]> {
    const res = await apiClient.patch<UtilityBill[]>(
      `/households/${householdId}/utilities/bills/paid-status`,
      { updates }
    );
    return res.data;
  },

  // Property Taxes
  async createPropertyTax(householdId: string, data: CreatePropertyTaxRequest): Promise<PropertyTax> {
    const res = await apiClient.post<PropertyTax>(
      `/households/${householdId}/utilities/property-taxes`,
      data
    );
    return res.data;
  },

  async getPropertyTaxes(householdId: string): Promise<PropertyTax[]> {
    const res = await apiClient.get<PropertyTax[]>(
      `/households/${householdId}/utilities/property-taxes`
    );
    return res.data;
  },

  async getPropertyTaxByYear(householdId: string, year: number): Promise<PropertyTax> {
    const res = await apiClient.get<PropertyTax>(
      `/households/${householdId}/utilities/property-taxes/${year}`
    );
    return res.data;
  },

  async updatePropertyTax(
    householdId: string,
    taxId: string,
    data: UpdatePropertyTaxRequest
  ): Promise<PropertyTax> {
    const res = await apiClient.patch<PropertyTax>(
      `/households/${householdId}/utilities/property-taxes/${taxId}`,
      data
    );
    return res.data;
  },

  /**
   * Upload a property tax notice (PDF/image) and extract its data with AI.
   * Returns the parsed data + a create-ready `suggestedTax` for the client to
   * review (paid/unpaid + grant) before calling {@link createPropertyTax}.
   */
  async uploadAndExtractPropertyTax(
    householdId: string,
    file: { uri: string; type: string; name: string }
  ): Promise<PropertyTaxUploadResponse> {
    const formData = new FormData();
    // React Native's FormData accepts a {uri,type,name} file part at runtime,
    // but its web-derived types only allow string | Blob — hence the cast.
    formData.append('file', {
      uri: file.uri,
      type: file.type || 'application/pdf',
      name: file.name || 'property-tax.pdf',
    } as unknown as Blob);

    return api.upload<PropertyTaxUploadResponse>(
      `/households/${householdId}/utilities/property-taxes/upload`,
      formData
    );
  },

  // BC Assessment
  async createBCAssessment(householdId: string, data: CreateBCAssessmentRequest): Promise<BCAssessmentData> {
    const res = await apiClient.post<BCAssessmentData>(
      `/households/${householdId}/utilities/bc-assessment`,
      data
    );
    return res.data;
  },

  async getBCAssessments(householdId: string): Promise<BCAssessmentData[]> {
    const res = await apiClient.get<BCAssessmentData[]>(
      `/households/${householdId}/utilities/bc-assessment`
    );
    return res.data;
  },

  async updateBCAssessment(
    householdId: string,
    assessmentId: string,
    data: UpdateBCAssessmentRequest
  ): Promise<BCAssessmentData> {
    const res = await apiClient.patch<BCAssessmentData>(
      `/households/${householdId}/utilities/bc-assessment/${assessmentId}`,
      data
    );
    return res.data;
  },

  /**
   * Upload a BC Assessment notice (PDF/image) and extract its data with AI.
   * Returns the parsed data + a create-ready `suggestedAssessment` for the
   * client to review before calling {@link createBCAssessment} (or
   * {@link updateBCAssessment} when `duplicate` is true).
   */
  async uploadAndExtractAssessment(
    householdId: string,
    file: { uri: string; type: string; name: string }
  ): Promise<BCAssessmentUploadResponse> {
    const formData = new FormData();
    // React Native's FormData accepts a {uri,type,name} file part at runtime,
    // but its web-derived types only allow string | Blob — hence the cast.
    formData.append('file', {
      uri: file.uri,
      type: file.type || 'application/pdf',
      name: file.name || 'assessment.pdf',
    } as unknown as Blob);

    return api.upload<BCAssessmentUploadResponse>(
      `/households/${householdId}/utilities/bc-assessment/upload`,
      formData
    );
  },

  // Property insights (combined assessment + tax, server-computed)
  async getPropertyInsights(householdId: string): Promise<PropertyInsights> {
    const res = await apiClient.get<PropertyInsights>(
      `/households/${householdId}/utilities/property-overview`
    );
    return res.data;
  },

  // Dashboard
  async getDashboard(householdId: string): Promise<DashboardOverview> {
    const res = await apiClient.get<DashboardOverview>(
      `/households/${householdId}/utilities/dashboard`
    );
    return res.data;
  },

  async getAnalytics(
    householdId: string,
    filters?: {
      startYear?: number;
      endYear?: number;
      utilityType?: string;
      providerKey?: ProviderKey;
    }
  ): Promise<BillAnalytics> {
    const params = new URLSearchParams();
    if (filters?.startYear) params.append('startYear', String(filters.startYear));
    if (filters?.endYear) params.append('endYear', String(filters.endYear));
    if (filters?.utilityType) params.append('utilityType', filters.utilityType);
    if (filters?.providerKey) params.append('providerKey', filters.providerKey);
    const query = params.toString();
    const res = await apiClient.get<BillAnalytics>(
      `/households/${householdId}/utilities/analytics${query ? `?${query}` : ''}`
    );
    return res.data;
  },

  // Bill Upload & Extraction
  async uploadAndExtractBill(
    householdId: string,
    file: { uri: string; type: string; name: string },
    autoCreate: boolean = false
  ): Promise<BillUploadResponse> {
    const formData = new FormData();
    // React Native's FormData accepts a {uri,type,name} file part at runtime,
    // but its web-derived types only allow string | Blob — hence the cast.
    formData.append('file', {
      uri: file.uri,
      type: file.type || 'application/pdf',
      name: file.name || 'bill.pdf',
    } as unknown as Blob);
    formData.append('autoCreate', autoCreate.toString());

    return api.upload<BillUploadResponse>(
      `/households/${householdId}/utilities/bills/upload`,
      formData
    );
  },

  async extractBillFromDocument(
    householdId: string,
    documentUrl: string
  ): Promise<{
    success: boolean;
    extractedData: ExtractedBillData;
    confidence: ExtractedBillData['confidence'];
    tokensUsed: number;
    suggestedBill: BillUploadResponse['suggestedBill'];
  }> {
    const res = await apiClient.post<{
      success: boolean;
      extractedData: ExtractedBillData;
      confidence: ExtractedBillData['confidence'];
      tokensUsed: number;
      suggestedBill: BillUploadResponse['suggestedBill'];
    }>(`/households/${householdId}/utilities/bills/extract`, { documentUrl });
    return res.data;
  },
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `utilitiesApi` exactly as before; the Proxy is what makes the H11 C1 cutover
 * cost zero screen edits. See `documents/requirements/House v2/` §6, §11
 * (sub-wave C1).
 *
 * Nineteen of the 24 methods are local, including the three that look most like
 * server features and are not: `getDashboard`, `getAnalytics` and
 * `getPropertyInsights` are pure functions of rows the device already holds, so
 * leaving them remote would render "$0.00 this month" over a full year of bills.
 * The table that DOES pre-compute this server-side, `utility_trends`, is ledgered
 * as of the H13 D-wave but has no local READER: the three methods above derive
 * the same numbers live from `utility_bills`, which is strictly better than a
 * cache that can go stale. It is registered for convergence — so a row a
 * server-side path writes merges rather than stranding — not because anything
 * here reads it.
 *
 * `remoteMethods` names ONE Tier C read. `municipality_configs` is global
 * reference data shared by every household — due dates, penalty schedules and
 * portal links for each BC municipality — so fetching it from the Worker leaks
 * nothing, and it is the same call `garbageCollectionApi.getMunicipality` makes.
 * It is declared here rather than left to fall through, so "this one goes to the
 * server" is a decision in the code.
 *
 * The remaining four — the bill, tax-notice and assessment scans, and the
 * re-extract — are PRESENT locally as throws with member-facing copy, which is
 * what the coverage rule asks for: a missing key would route the upload to a
 * Worker that would happily accept the PDF and file the resulting record into a
 * household whose rows live somewhere else entirely.
 */
export const utilitiesApi: typeof remoteUtilitiesApi = createHouseLocalProxy(
  remoteUtilitiesApi,
  {
    moduleName: 'utilitiesApi',
    remoteMethods: ['getMunicipality'],
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localUtilitiesApi').localUtilitiesApi,
  },
);

/**
 * Inspect a rejected `createBill` promise for the backend's month-based
 * duplicate signal (HTTP 409, `code: 'DUPLICATE_BILL'`).
 *
 * @returns `undefined` when the error is NOT a duplicate (caller should handle
 *   it as a normal failure); the existing `UtilityBill` when the server sent
 *   one; or `null` when it's a duplicate but no bill details were included.
 */
export function getDuplicateBill(error: unknown): UtilityBill | null | undefined {
  const response = (error as { response?: { status?: number; data?: { code?: string; existingBill?: UtilityBill } } })
    ?.response;
  if (response?.status === 409 && response.data?.code === 'DUPLICATE_BILL') {
    return response.data.existingBill ?? null;
  }
  return undefined;
}
