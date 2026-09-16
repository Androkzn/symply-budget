# Utilities & Taxes Feature Plan
## Greater Vancouver Area Homeowner Management System

**Document Version:** 1.0
**Date:** January 23, 2026
**Region:** Greater Vancouver Area (Metro Vancouver), BC, Canada

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Research Findings](#research-findings)
3. [Feature Specifications](#feature-specifications)
4. [Architecture Design](#architecture-design)
5. [UX/UI Recommendations](#uxui-recommendations)
6. [Implementation Phases](#implementation-phases)
7. [Portal Links & Resources](#portal-links--resources)

---

## Executive Summary

This document outlines the implementation plan for a comprehensive utilities and taxes tracking feature for Greater Vancouver Area homeowners. The system will:
- Track utility bills (electricity, natural gas, garbage/water/sewer)
- Manage property tax payments and deadlines
- Provide intelligent reminders and notifications
- Use AI to scan and extract data from bills/documents
- Store historical data for trend analysis
- Auto-detect applicable rules by property address

---

## Research Findings

### 1. Utility Providers in Greater Vancouver

#### Electricity - BC Hydro
| Attribute | Details |
|-----------|---------|
| **Provider** | BC Hydro (serves most of GVA) |
| **Billing Cycle** | Bimonthly (every 2 months) |
| **Payment Deadline** | 21 days from billing date |
| **Rate Plans** | Tiered rate, Flat rate, Time-of-day pricing (optional) |
| **2025-2026 Increase** | 3.75% annually |
| **Average Monthly Cost** | ~$100/month residential |
| **Portal** | https://app.bchydro.com |
| **Exceptions** | New Westminster, Penticton, Nelson have own utilities |

#### Natural Gas - FortisBC
| Attribute | Details |
|-----------|---------|
| **Provider** | FortisBC |
| **Billing Cycle** | Customer choice: Monthly or Bimonthly |
| **Rate Components** | Basic charge + Delivery charge + Commodity cost |
| **2026 Increase** | ~11.1% (~$10.95/month increase) |
| **Average Consumption** | ~7.5 GJ/month |
| **RNG Blend** | 3% as of July 1, 2025 |
| **Portal** | https://www.fortisbc.com |
| **Emergency Line** | 1-800-663-9911 (24 hours) |

#### Water, Sewer, Garbage - Municipal
These utilities are handled differently by each municipality:

| Municipality | Billing Method | Payment Due |
|--------------|---------------|-------------|
| Vancouver | Property tax notice (flat rate) OR Metered quarterly | July (flat) / Quarterly (metered) |
| Burnaby | Separate utility bill | March 17 |
| Surrey | Separate annual utility bill | April 2 |
| Richmond | Separate utility bill | March 31 |
| Coquitlam | Separate utility bill | March 31 |

---

### 2. Property Tax Key Dates by Municipality

| Municipality | Tax Due Date | Utility Due Date | Early Discount | Late Penalty |
|--------------|--------------|------------------|----------------|--------------|
| **Vancouver** | July 3 | July 3 (flat rate) | None | 5% after due date |
| **Burnaby** | July 2 | March 17 | 5% if paid early | 5% + 5% Sept |
| **Surrey** | Early July | April 2 | Via PAPP | 5% + 5% |
| **Richmond** | Early July | March 31 | 10% if on time | Daily interest |
| **Coquitlam** | July 2 | March 31 | None | 5% + 5% |
| **New Westminster** | July 2 | Varies | None | 5% + 5% Sept 6 |
| **North Van (City)** | July 2 | Varies | None | 5% |
| **North Van (District)** | July 2 | Varies | None | 5% |
| **West Vancouver** | July 2 | Varies | None | 5% + 5% Sept 2 |
| **Port Coquitlam** | July 2 | Varies | None | 5% |
| **Maple Ridge** | July 2 | With property tax | None | 5% |
| **Pitt Meadows** | July 2 | Varies | None | 5% + 5% Aug 1 |
| **Delta** | Early July | Varies | Check website | 5% |
| **Langley (City/Township)** | Early July | Varies | Check website | 5% |
| **Port Moody** | Early July | Varies | Check website | 5% |
| **White Rock** | Early July | Varies | Check website | 5% |

---

### 3. BC Assessment & Home Owner Grant

#### BC Assessment
- **Assessment Date:** Based on July 1 market value of previous year
- **Notices Sent:** January each year
- **Appeal Deadline:** January 31 each year
- **Portal:** https://www.bcassessment.ca

#### BC Home Owner Grant 2026
| Grant Type | Amount | Threshold |
|------------|--------|-----------|
| Regular Grant | Up to $770 | $2,075,000 property value |
| Additional (seniors/veterans/disability) | Higher amounts | $2,244,000 (regular) / $2,284,000 (rural) |
| Phase-out | $5 reduction per $1,000 over threshold | Above threshold |

**Application:**
- Apply online: https://www.gov.bc.ca/homeownergrant
- Phone: 1-888-355-2700
- Deadline: Property tax due date (typically July 2-3)
- Can apply retroactively for previous year until Dec 31

---

### 4. Metro Vancouver Complete Municipality List (21 Municipalities)

**Cities:**
1. Vancouver
2. Burnaby
3. Surrey
4. Richmond
5. Coquitlam
6. New Westminster
7. North Vancouver (City)
8. Langley (City)
9. Maple Ridge
10. Port Coquitlam
11. Port Moody
12. Pitt Meadows
13. White Rock

**Districts/Townships:**
14. North Vancouver (District)
15. West Vancouver
16. Delta
17. Langley (Township)

**Villages:**
18. Anmore
19. Belcarra
20. Lions Bay

**Municipality:**
21. Bowen Island

**Other Areas:**
- Electoral Area A (UBC, University Endowment Lands)
- Tsawwassen First Nation (treaty First Nation)

---

### 5. Competitor Analysis - Bill Tracking Apps

| App | Strengths | Weaknesses | Price |
|-----|-----------|------------|-------|
| **Monarch Money** | Bill detection, calendar view, AI, investment tracking | Subscription cost | $13/mo or $95/yr |
| **YNAB** | Zero-based budgeting, education | Learning curve, no bill scanning | $14.99/mo |
| **PocketGuard** | Bill negotiation, alerts, subscription detection | Limited Canadian features | Freemium |
| **Copilot Money** | AI categorization, bill splitting | Apple only | $13/mo or $95/yr |
| **Honeydue** | Free, couples-focused | Limited features | Free |
| **TimelyBills** | Smart reminders, payment tracking | Basic features | Free |

**Gap in Market:** No app specifically designed for Canadian/BC homeowners with:
- Municipal-specific deadlines and rules
- BC Assessment integration
- Home Owner Grant reminders
- Canadian utility provider integration (BC Hydro, FortisBC)

---

### 6. AI Document Scanning Solutions

| Solution | Accuracy | Features | Best For |
|----------|----------|----------|----------|
| **Microsoft Document Intelligence** | High | Invoice extraction, PDFs, multi-format | Enterprise integration |
| **Koncile AI** | 99%+ | API-first, scanned PDFs, images | High volume processing |
| **DocuClipper** | 97.5% | 1M+ invoice formats trained | Varied invoice types |
| **Klippa** | 99% | Multi-document types, receipts | General document scanning |
| **SpendConsole** | 99%+ | Learning AI, handwritten support | Complex layouts |

**Recommended Approach:** Use Microsoft Document Intelligence or Google Document AI for:
- PDF bill extraction
- Scanned document processing
- Key field extraction (amount, due date, account number)
- Multi-language support

---

## Feature Specifications

### Core Features

#### 1. Utility Tracking
```
- Track multiple utility types:
  □ Electricity (BC Hydro)
  □ Natural Gas (FortisBC)
  □ Water/Sewer (Municipal)
  □ Garbage/Recycling (Municipal)
  □ Other (custom)

- For each utility:
  □ Provider information
  □ Account number
  □ Billing cycle (monthly/bimonthly/quarterly/annual)
  □ Average cost
  □ Historical data
  □ Bill attachments (PDF/images)
```

#### 2. Property Tax Management
```
- Property information:
  □ Address (auto-detect municipality)
  □ Folio/Roll number
  □ BC Assessment value
  □ Assessment history

- Tax tracking:
  □ Annual tax amount
  □ Advance payment (February)
  □ Main payment (July)
  □ Home Owner Grant status
  □ Payment confirmation
```

#### 3. Smart Reminders & Notifications
```
Reminder Schedule:
├── 14 days before due date (Planning reminder)
├── 7 days before due date (Action reminder)
├── 3 days before due date (Urgent reminder)
├── 1 day before due date (Final reminder)
└── Day of due date (Last chance)

Additional Reminders:
├── Home Owner Grant application (June)
├── BC Assessment appeal deadline (January 31)
├── Early payment discounts (where applicable)
└── Rate increase announcements
```

#### 4. AI Document Scanner
```
Capabilities:
├── Scan PDF bills
├── Scan photographed bills
├── Extract key data:
│   ├── Bill amount
│   ├── Due date
│   ├── Billing period
│   ├── Account number
│   └── Usage data (kWh, GJ, m³)
├── Auto-populate expense records
└── Store original documents in organized folders
```

#### 5. Analytics & Trends
```
Charts and Reports:
├── Monthly expense comparison
├── Year-over-year trends
├── Seasonal patterns (heating, cooling)
├── Usage tracking (electricity, gas, water)
├── Cost projection
└── Budget vs actual
```

#### 6. Municipality Auto-Detection
```
By Address Detection:
├── Parse property address
├── Identify municipality
├── Apply correct:
│   ├── Tax due dates
│   ├── Utility billing cycles
│   ├── Discount opportunities
│   ├── Penalty structures
│   └── Portal links
└── Update when bylaws change
```

---

### Data Model

#### Utility Bill Record
```typescript
interface UtilityBill {
  id: string;
  propertyId: string;
  utilityType: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  provider: string;
  accountNumber: string;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  amount: number;
  dueDate: Date;
  paidDate?: Date;
  paidAmount?: number;
  usage?: {
    quantity: number;
    unit: string; // kWh, GJ, m³, etc.
  };
  documentUrl?: string;
  extractedData?: object; // AI-extracted fields
  createdAt: Date;
  updatedAt: Date;
}
```

#### Property Tax Record
```typescript
interface PropertyTax {
  id: string;
  propertyId: string;
  taxYear: number;
  assessedValue: number;
  taxAmount: number;
  advancePayment?: {
    amount: number;
    dueDate: Date;
    paidDate?: Date;
  };
  mainPayment: {
    amount: number;
    dueDate: Date;
    paidDate?: Date;
  };
  homeOwnerGrant?: {
    eligible: boolean;
    amount: number;
    appliedDate?: Date;
    status: 'pending' | 'approved' | 'rejected';
  };
  penalties: Array<{
    date: Date;
    percentage: number;
    amount: number;
  }>;
  documentUrl?: string;
}
```

#### Property Record
```typescript
interface Property {
  id: string;
  userId: string;
  address: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
  municipality: Municipality;
  folioNumber: string;
  bcAssessmentPID?: string;
  propertyType: 'single_family' | 'townhouse' | 'condo' | 'duplex' | 'other';
  purchaseDate?: Date;
  utilityAccounts: UtilityAccount[];
}
```

#### Municipality Configuration
```typescript
interface MunicipalityConfig {
  id: string;
  name: string;
  code: string; // e.g., 'VAN', 'BUR', 'SUR'
  propertyTax: {
    advanceDueDate: string; // "February first business day"
    mainDueDate: string; // "July first business day"
    penalties: Array<{
      daysAfterDue: number;
      percentage: number;
    }>;
  };
  utilities: {
    provider: string;
    billingCycle: string;
    dueDate: string;
    earlyDiscount?: number;
  };
  portalUrl: string;
  contactPhone: string;
  contactEmail?: string;
}
```

---

## Architecture Design

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Mobile  │  │   Web    │  │  Widget  │  │  Email   │        │
│  │   App    │  │   App    │  │ (iOS/And)│  │ Digests  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
└───────┼─────────────┼─────────────┼─────────────┼───────────────┘
        │             │             │             │
        └─────────────┴──────┬──────┴─────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                      API GATEWAY                                 │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────┐              │
│  │    Auth     │  │    Rate    │  │   Request   │              │
│  │  (JWT/OAuth)│  │  Limiting  │  │   Logging   │              │
│  └─────────────┘  └────────────┘  └─────────────┘              │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                     BACKEND SERVICES                             │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Property   │  │   Utility    │  │    Tax       │          │
│  │   Service    │  │   Service    │  │   Service    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Document    │  │ Notification │  │  Analytics   │          │
│  │  Scanner     │  │   Service    │  │   Service    │          │
│  │  (AI/OCR)    │  │              │  │              │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ Municipality │  │   Address    │                            │
│  │   Config     │  │   Lookup     │                            │
│  │   Service    │  │   Service    │                            │
│  └──────────────┘  └──────────────┘                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                     DATA LAYER                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  PostgreSQL  │  │    Redis     │  │     S3       │          │
│  │  (Main DB)   │  │   (Cache)    │  │  (Documents) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                 EXTERNAL INTEGRATIONS                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Google/MS   │  │   Push       │  │   Canada     │          │
│  │  Document AI │  │   (FCM/APNs) │  │   Post API   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack Recommendations

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Mobile** | React Native / Flutter | Cross-platform, single codebase |
| **Web** | React/Next.js | SSR support, fast development |
| **API** | Node.js/Express or NestJS | TypeScript support, scalable |
| **Database** | PostgreSQL | Relational data, JSON support |
| **Cache** | Redis | Session, rate limiting, caching |
| **File Storage** | AWS S3 / GCP Storage | Document storage, CDN support |
| **AI/OCR** | Google Document AI or Azure Document Intelligence | High accuracy, PDF support |
| **Push Notifications** | Firebase Cloud Messaging + APNs | Cross-platform push |
| **Background Jobs** | Bull/BullMQ with Redis | Scheduled reminders, processing |
| **Email** | SendGrid / AWS SES | Transactional emails |

### Document Processing Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENT UPLOAD                           │
│  User uploads PDF/Image → Validate format → Store in S3     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI EXTRACTION                             │
│  Send to Document AI → Extract fields → Confidence scoring  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA MAPPING                              │
│  Map to bill type → Identify provider → Match to property   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    USER CONFIRMATION                         │
│  Show extracted data → User reviews/edits → Save to DB      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    ORGANIZATION                              │
│  Categorize document → Store in folder structure:           │
│  /properties/{id}/utilities/{type}/{year}/                  │
│  /properties/{id}/taxes/{year}/                             │
└─────────────────────────────────────────────────────────────┘
```

---

## UX/UI Recommendations

### Mobile App Screens

#### 1. Dashboard
```
┌─────────────────────────────────┐
│  🏠 My Home                     │
│  123 Main St, Vancouver, BC    │
├─────────────────────────────────┤
│                                 │
│  UPCOMING PAYMENTS              │
│  ┌───────────────────────────┐  │
│  │ ⚡ BC Hydro        $142.50│  │
│  │    Due: Feb 15, 2026     │  │
│  │    [Pay Now]             │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ 🔥 FortisBC        $98.75│  │
│  │    Due: Feb 28, 2026     │  │
│  │    [Pay Now]             │  │
│  └───────────────────────────┘  │
│                                 │
│  QUICK STATS                    │
│  ┌─────────┬─────────┬───────┐  │
│  │  This   │  vs     │ Trend │  │
│  │  Month  │  Last   │       │  │
│  │ $412    │  +$23   │  ↗    │  │
│  └─────────┴─────────┴───────┘  │
│                                 │
│  [📷 Scan Bill] [+ Add Manual]  │
└─────────────────────────────────┘
```

#### 2. Bill Scanner
```
┌─────────────────────────────────┐
│  ← Scan Bill                    │
├─────────────────────────────────┤
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │    📷                     │  │
│  │                           │  │
│  │   Position bill within    │  │
│  │   the frame               │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  [Take Photo]  [Choose File]    │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  Extracted Data:                │
│  Provider: BC Hydro            │
│  Amount: $142.50 ✓             │
│  Due Date: Feb 15, 2026 ✓      │
│  Period: Dec 15 - Feb 14 ✓     │
│  Usage: 1,234 kWh ✓            │
│                                 │
│  [Edit] [Confirm & Save]        │
└─────────────────────────────────┘
```

#### 3. Property Tax View
```
┌─────────────────────────────────┐
│  ← 2026 Property Taxes          │
├─────────────────────────────────┤
│                                 │
│  BC Assessment Value            │
│  $1,450,000 (+3.2% from 2025)  │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  PAYMENT SCHEDULE               │
│                                 │
│  Advance Payment    ✓ PAID      │
│  Due: Feb 3, 2026              │
│  Amount: $1,245.00             │
│                                 │
│  Main Payment       ○ PENDING   │
│  Due: Jul 3, 2026              │
│  Amount: $4,980.00             │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  HOME OWNER GRANT               │
│  Status: Not Applied           │
│  Potential Savings: $770       │
│  [Apply Now →]                 │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  📊 View Historical Trends     │
│  🔗 Open City Portal           │
└─────────────────────────────────┘
```

#### 4. Analytics/Charts
```
┌─────────────────────────────────┐
│  ← Analytics                    │
├─────────────────────────────────┤
│                                 │
│  MONTHLY EXPENSES               │
│  ┌───────────────────────────┐  │
│  │    ▄                      │  │
│  │   ▄█▄    ▄     ▄         │  │
│  │  ▄███▄  ▄█▄   ▄█▄    ▄   │  │
│  │ ▄█████▄▄███▄ ▄███▄  ▄█▄  │  │
│  │ J F M A M J J A S O N D  │  │
│  └───────────────────────────┘  │
│                                 │
│  BY UTILITY TYPE                │
│  ┌───────────────────────────┐  │
│  │ ⚡ Electricity    45%     │  │
│  │ 🔥 Gas           30%     │  │
│  │ 💧 Water         15%     │  │
│  │ 🗑️ Garbage       10%     │  │
│  └───────────────────────────┘  │
│                                 │
│  YEAR OVER YEAR                 │
│  2024: $4,850/year             │
│  2025: $5,120/year (+5.6%)     │
│  2026: $5,340/year (projected) │
│                                 │
└─────────────────────────────────┘
```

#### 5. Reminders Settings
```
┌─────────────────────────────────┐
│  ← Notification Settings        │
├─────────────────────────────────┤
│                                 │
│  REMINDER TIMING                │
│                                 │
│  First Reminder                 │
│  [14 days] before due date  ▼  │
│                                 │
│  Second Reminder                │
│  [7 days] before due date   ▼  │
│                                 │
│  Final Reminder                 │
│  [1 day] before due date    ▼  │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  NOTIFICATION CHANNELS          │
│                                 │
│  Push Notifications    [ON]     │
│  Email Reminders       [ON]     │
│  SMS Reminders         [OFF]    │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  SPECIAL REMINDERS              │
│                                 │
│  Home Owner Grant      [ON]     │
│  BC Assessment Appeal  [ON]     │
│  Rate Increases        [ON]     │
│  Early Payment Deals   [ON]     │
│                                 │
└─────────────────────────────────┘
```

### Key UX Principles

1. **One-Tap Access:** Most common actions (pay bill, scan, view upcoming) accessible from dashboard
2. **Progressive Disclosure:** Show summary first, details on tap
3. **Smart Defaults:** Pre-fill municipality rules based on address
4. **Visual Feedback:** Clear status indicators (paid/pending/overdue)
5. **Offline Support:** Cache critical data for offline viewing
6. **Accessibility:** Support for VoiceOver/TalkBack, high contrast modes

---

## Implementation Phases

### Phase 1: Foundation (4-6 weeks)
```
□ Database schema design and setup
□ Basic API infrastructure
□ User authentication (email + social)
□ Property management (CRUD)
□ Manual bill entry
□ Basic dashboard UI
```

### Phase 2: Core Features (6-8 weeks)
```
□ Municipality configuration system (all 21 GVA municipalities)
□ Address auto-detection and municipality lookup
□ Utility bill tracking
□ Property tax tracking
□ Basic reminder system (push + email)
□ Home Owner Grant tracking
□ BC Assessment value display
```

### Phase 3: AI & Documents (4-6 weeks)
```
□ AI document scanning integration
□ PDF/image upload and processing
□ Data extraction and validation UI
□ Document storage and organization
□ Bill provider auto-detection
```

### Phase 4: Analytics & Intelligence (4-5 weeks)
```
□ Historical data charts
□ Year-over-year comparisons
□ Usage tracking and trends
□ Cost projections
□ Seasonal analysis
□ Export reports (PDF/CSV)
```

### Phase 5: Polish & Launch (3-4 weeks)
```
□ Portal links integration
□ Widget development (iOS/Android)
□ Email digest reports
□ Performance optimization
□ Security audit
□ App Store submission
□ Beta testing with GVA homeowners
```

### Phase 6: Future Enhancements
```
□ Strata fee tracking (condos/townhouses)
□ Insurance reminders
□ Mortgage payment tracking
□ Home maintenance scheduling
□ Multi-property support
□ Family/household sharing
□ Expand to other BC regions
□ Expand to other Canadian provinces
```

---

## Portal Links & Resources

### Municipal Property Tax & Utilities Portals

| Municipality | Property Tax Portal | Contact |
|--------------|--------------------| --------|
| **Vancouver** | https://vancouver.ca/home-property-development/property-tax.aspx | 311 |
| **Burnaby** | https://www.burnaby.ca/services-and-payments/property-taxes | 604-294-7350 |
| **Surrey** | https://www.surrey.ca/services-payments/property-taxes | 604-591-4181 |
| **Richmond** | https://www.richmond.ca/city-hall/finance/rates/howtopay.htm | 604-276-4145 |
| **Coquitlam** | https://www.coquitlam.ca/544/Property-Taxes | 604-927-3000 |
| **New Westminster** | https://www.newwestcity.ca/propertytaxes-utilities | 604-527-4523 |
| **North Vancouver (City)** | https://www.cnv.org/home-property/property-taxes | 604-985-7761 |
| **North Vancouver (District)** | https://www.dnv.org/your-home-property/property-taxes | 604-990-2311 |
| **West Vancouver** | https://westvancouver.ca/services/taxes-utility-fees | 604-925-7000 |
| **Maple Ridge** | https://www.mapleridge.ca/your-government/property-taxes | 604-463-5221 |
| **Port Coquitlam** | https://www.portcoquitlam.ca/services/property-taxes | 604-927-5411 |
| **Port Moody** | https://www.portmoody.ca/ | 604-469-4500 |
| **Pitt Meadows** | https://www.pittmeadows.ca/city-hall/property-taxes | 604-465-5454 |
| **Delta** | https://www.delta.ca/ | 604-946-4141 |
| **Langley (City)** | https://www.langleycity.ca/ | 604-514-2800 |
| **Langley (Township)** | https://www.tol.ca/ | 604-534-3211 |
| **White Rock** | https://www.whiterockcity.ca/ | 604-541-2100 |

### Utility Provider Portals

| Provider | Portal | Phone |
|----------|--------|-------|
| **BC Hydro** | https://app.bchydro.com | 1-800-224-9376 |
| **FortisBC** | https://www.fortisbc.com | 1-888-224-2710 |
| **BC Assessment** | https://www.bcassessment.ca | 1-866-825-8322 |
| **Home Owner Grant** | https://www.gov.bc.ca/homeownergrant | 1-888-355-2700 |

### Key Annual Dates Calendar

| Date | Event |
|------|-------|
| **January (early)** | BC Assessment notices mailed |
| **January 31** | BC Assessment appeal deadline |
| **February (early)** | Vancouver advance property tax due |
| **March (mid)** | Burnaby utilities due |
| **March 31** | Richmond & Coquitlam utilities due |
| **April 2** | Surrey utilities due |
| **May (late)** | Property tax notices mailed |
| **July 2-3** | Property taxes due (most municipalities) |
| **July 2-3** | Home Owner Grant application deadline |
| **September (early)** | Second penalty date (many municipalities) |
| **December 31** | Final date for current year HOG; taxes transfer to arrears |

---

## Summary

This utilities and taxes feature will provide Greater Vancouver homeowners with a comprehensive, intelligent system for managing their home-related financial obligations. The key differentiators are:

1. **BC-Specific:** Built specifically for BC regulations, providers, and municipal rules
2. **Auto-Detection:** Automatically applies correct rules based on property address
3. **AI-Powered:** Scan bills with high accuracy document extraction
4. **Proactive Reminders:** Never miss a deadline with smart multi-stage reminders
5. **Historical Insights:** Track spending trends and predict future costs
6. **All-in-One:** Utilities, property taxes, and Home Owner Grant in one place

This feature will be a significant value-add for homeowners in the Greater Vancouver Area, addressing a clear gap in the Canadian personal finance app market.

---

*Document prepared based on research conducted January 2026*
