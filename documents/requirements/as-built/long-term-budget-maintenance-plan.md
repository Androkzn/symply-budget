# Long-Term Budget & Maintenance Planning Feature

## Executive Summary

A comprehensive budget and maintenance planning system that allows homeowners to plan both short-term (annual) and long-term (10+ years) capital expenditures, maintenance tasks, and home improvements. Inspired by professional property management tactical planning horizons, this feature provides visual forecasting, cost tracking, and intelligent recommendations.

---

## Research Findings & Best Practices

### Key Insights from Research

1. **Budget Guidelines:**
   - Save 1-4% of home value annually for maintenance
   - Alternative: $1 per square foot per year
   - Set aside 5% of income + $10,000 emergency fund
   - Older homes (pre-1960) require 0.8% vs 0.2% for newer homes

2. **Main Challenges:**
   - Lack of real-time updates in manual tracking
   - High complexity across multiple projects
   - Data silos preventing integration
   - Human error in forecasting
   - Limited collaboration

3. **Best Practices:**
   - Automated preventative maintenance schedules
   - Expense tracking with receipt storage
   - Replacement calculators for major systems
   - Visual planning views (charts, timelines)
   - Category-based organization
   - Integration with action items from inspections

---

## Feature Overview

### Core Capabilities

1. **Multi-Horizon Planning:**
   - Short-term: Current year, quarterly, monthly
   - Long-term: 2-5 years, 5-10 years, 10+ years
   - Visual timeline similar to tactical forecast charts

2. **Budget Types:**
   - **Maintenance:** Replace heating, fix breakers, fireplace maintenance
   - **Repairs:** Urgent fixes, system replacements
   - **Improvements:** Deck upgrades, hot tub purchase, renovations
   - **Recurring:** Annual HVAC service, quarterly gutter cleaning

3. **System Categories** (matching inspection report categories):
   - Structural
   - Electrical
   - Plumbing
   - HVAC
   - Roof/Enclosure
   - Interior
   - Exterior/Sitework
   - Appliances
   - Safety/Fire
   - Other

---

## Database Schema Enhancements

### New/Enhanced Tables

```sql
-- Enhanced budget_items (already exists, needs year/quarter support)
-- Add system_category field to align with inspection findings
ALTER TABLE budget_items ADD COLUMN system_category TEXT;

-- New: Budget forecasts for multi-year planning
CREATE TABLE budget_forecasts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  forecast_year INTEGER NOT NULL,
  total_planned_min INTEGER, -- in cents
  total_planned_max INTEGER,
  total_actual INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- New: System-based budget summaries (for chart visualization)
CREATE TABLE budget_system_summaries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  forecast_year INTEGER NOT NULL,
  system_category TEXT NOT NULL,
  total_cost_min INTEGER,
  total_cost_max INTEGER,
  total_actual INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(household_id, forecast_year, system_category)
);

-- Enhanced: Link maintenance tasks to budget items
ALTER TABLE maintenance_tasks ADD COLUMN budget_item_id TEXT REFERENCES budget_items(id);
```

---

## API Endpoints

### Budget Planning

```
GET    /api/households/:id/budget/overview
       - Get budget overview with timeline summary
       - Returns: current year, next 5 years, 10-year forecast

GET    /api/households/:id/budget/timeline
       - Get budget items by timeframe
       - Query params: ?timeframe=1_year&year=2026

GET    /api/households/:id/budget/forecast
       - Get multi-year forecast (2-10 years)
       - Query params: ?years=10&groupBy=system

POST   /api/households/:id/budget/items
       - Create budget item (maintenance, repair, improvement)
       - Body: { title, description, system_category, timeframe, year, 
                 estimated_cost_min, estimated_cost_max, priority, 
                 target_date, is_recurring, recurrence_frequency }

PUT    /api/households/:id/budget/items/:itemId
       - Update budget item

DELETE /api/households/:id/budget/items/:itemId
       - Delete budget item

POST   /api/households/:id/budget/items/:itemId/complete
       - Mark item as completed with actual cost
       - Body: { actual_cost, completed_at }

GET    /api/households/:id/budget/chart
       - Get data for visualization chart
       - Returns: Year-by-year breakdown by system category
       - Format: { years: [2024, 2025, ...], systems: {...}, totals: {...} }
```

### Budget Analysis

```
GET    /api/households/:id/budget/analysis
       - Budget vs actual analysis
       - Spending trends
       - Category breakdowns

GET    /api/households/:id/budget/recommendations
       - AI-powered budget recommendations
       - Based on home age, inspection findings, maintenance history
       - Suggests timing for major replacements
```

---

## Frontend Components

### 1. Budget Dashboard

**Location:** `/budget` or `/household/:id/budget`

**Features:**
- **Current Year View:**
  - Monthly/quarterly breakdown
  - Planned vs actual spending
  - Upcoming items this year
  - Budget alerts (over budget, approaching limit)

- **Long-Term Forecast View:**
  - 10-year tactical planning chart (like image)
  - Stacked bar chart by year
  - Color-coded by system category
  - Interactive: click to see details, drag to reschedule

- **Quick Actions:**
  - "Add Maintenance Item"
  - "Add Improvement"
  - "Sync from Inspection Report"
  - "Generate Forecast"

### 2. Budget Planning Chart

**Component:** `BudgetForecastChart.tsx`

**Visualization:**
- Stacked bar chart (similar to provided image)
- X-axis: Years (2024-2034)
- Y-axis: Cost ($0 - $X million)
- Colors: One per system category
- Interactive:
  - Hover: Show item details
  - Click: Edit item
  - Drag: Reschedule to different year
  - Zoom: Focus on specific year range

**Libraries:**
- Recharts or Chart.js for visualization
- D3.js for advanced interactions

### 3. Budget Item Form

**Component:** `BudgetItemForm.tsx`

**Fields:**
- **Basic Info:**
  - Title (e.g., "Replace heating system")
  - Description
  - System Category (dropdown)
  - Type: Maintenance / Repair / Improvement

- **Timing:**
  - Timeframe: Immediate / 1 month / 3 months / 6 months / 1 year / 2-5 years / 5-10 years
  - Specific Year (for long-term planning)
  - Target Date
  - Is Recurring? (checkbox)
  - Recurrence: Monthly / Quarterly / Yearly

- **Cost:**
  - Estimated Cost Min
  - Estimated Cost Max
  - Priority: Critical / High / Medium / Low

- **Source:**
  - Link to Inspection Finding (optional)
  - Link to Maintenance Task (optional)
  - Manual entry

### 4. Budget Timeline View

**Component:** `BudgetTimeline.tsx`

**Features:**
- Gantt-style timeline
- Items grouped by year
- Color-coded by priority
- Filter by system category
- Filter by type (maintenance/repair/improvement)
- Sort by cost, date, priority

### 5. Budget vs Actual Analysis

**Component:** `BudgetAnalysis.tsx`

**Features:**
- Year-over-year comparison
- Category spending trends
- Budget adherence metrics
- Cost variance analysis
- Spending forecasts based on history

---

## User Flows

### Flow 1: Plan Annual Budget

1. User navigates to Budget Dashboard
2. Sees current year view with existing items
3. Clicks "Add Item" or "Plan for This Year"
4. Fills out form:
   - "Maintain wood fireplace" - Maintenance - Fire - $200-$400 - This year
   - "Replace electrical breakers" - Repair - Electrical - $500-$800 - This year
5. Items appear in current year view
6. User can see total planned budget for year
7. User sets annual budget goal
8. System tracks actual vs planned

### Flow 2: Long-Term Planning

1. User navigates to "10-Year Forecast" tab
2. Sees empty or populated chart
3. Clicks "Add Long-Term Item"
4. Fills out form:
   - "Replace heating system" - Repair - HVAC - $8,000-$12,000 - Year 2027
   - "Upgrade deck with wooden floor" - Improvement - Exterior - $5,000-$8,000 - Year 2025
   - "Buy hot tub" - Improvement - Amenities - $3,000-$5,000 - Year 2026
5. Items appear in chart as colored segments
6. User can drag items to different years
7. System shows cumulative costs per year
8. User can see which years will be expensive

### Flow 3: Sync from Inspection Report

1. User has inspection report with findings
2. System generates action plans (already exists)
3. User navigates to Budget Dashboard
4. Clicks "Sync from Inspection Report"
5. System creates budget items from action items:
   - Maps priority to timeframe
   - Uses estimated costs from action items
   - Links to original findings
6. Items appear in appropriate timeframes
7. User can review and adjust

### Flow 4: Track Actual Spending

1. User completes a budget item (e.g., "Maintain fireplace")
2. Clicks "Mark Complete" on item
3. Enters actual cost: $350
4. Optionally uploads receipt
5. System updates:
   - Item status: completed
   - Actual cost recorded
   - Budget vs actual analysis updated
   - Expense record created

### Flow 5: Recurring Maintenance

1. User adds recurring item:
   - "HVAC Annual Service" - Maintenance - HVAC - $200-$300
   - Recurring: Yearly
   - Starting: 2024
2. System automatically creates items for:
   - 2024, 2025, 2026, ... (up to forecast horizon)
3. User can see all instances in timeline
4. When one is completed, next one becomes active

---

## AI-Powered Features

### 1. Budget Recommendations

**Prompt:** Based on home age, inspection findings, and maintenance history, suggest:
- When to replace major systems (roof, HVAC, water heater)
- Annual maintenance budget recommendations
- Cost estimates based on local market rates
- Priority adjustments based on urgency

**Implementation:**
- Use Claude to analyze:
  - Home age and condition
  - Inspection report findings
  - Maintenance history
  - Local cost data (if available)
- Generate suggested budget items
- User can accept/reject/modify suggestions

### 2. Cost Estimation

**Enhancement to existing action plan generation:**
- More accurate cost estimates
- Consider home location (country/region)
- Factor in home size and complexity
- Provide confidence levels
- Update estimates based on actual spending history

### 3. Timing Optimization

**AI suggests optimal timing:**
- "You have 3 major expenses in 2027. Consider moving one to 2026 or 2028."
- "Your roof replacement is due in 2029. Start saving now."
- "Based on your spending pattern, you should budget $X more for unexpected repairs."

---

## System Categories & Defaults

### Category Definitions

Based on inspection report categories, enhanced for budget planning:

1. **Structural** (Dark Red)
   - Foundation repairs
   - Structural modifications
   - Load-bearing changes

2. **Electrical** (Purple)
   - Panel upgrades
   - Breaker replacements
   - Wiring updates
   - Smart home installations

3. **Plumbing** (Blue)
   - Pipe replacements
   - Fixture upgrades
   - Water heater replacement
   - Sewer line repairs

4. **HVAC** (Light Blue)
   - System replacement
   - Annual maintenance
   - Ductwork repairs
   - Thermostat upgrades

5. **Roof/Enclosure** (Green)
   - Roof replacement
   - Gutter repairs
   - Siding updates
   - Window replacements

6. **Interior** (Red)
   - Flooring
   - Paint
   - Drywall repairs
   - Room renovations

7. **Exterior/Sitework** (Yellow)
   - Deck upgrades
   - Landscaping
   - Driveway repairs
   - Fence installation

8. **Appliances** (Orange)
   - Appliance replacement
   - Appliance repairs
   - Smart appliance upgrades

9. **Safety/Fire** (Dark Brown)
   - Fireplace maintenance
   - Smoke detector updates
   - Security system installation
   - Fire suppression systems

10. **Amenities** (Light Grey)
    - Hot tub purchase
    - Pool installation
    - Outdoor kitchen
    - Home gym equipment

---

## Data Visualization

### Chart Types

1. **Tactical Forecast Chart** (Primary - like image)
   - Stacked bar chart
   - Years on X-axis
   - Cost on Y-axis
   - Colors by system category
   - Interactive tooltips

2. **Budget vs Actual**
   - Line chart comparing planned vs actual
   - Monthly/quarterly/yearly views
   - Variance indicators

3. **Category Breakdown**
   - Pie chart or donut chart
   - Shows spending by category
   - Can filter by year

4. **Timeline Gantt**
   - Horizontal bars showing item duration
   - Grouped by year
   - Color by priority

5. **Spending Trends**
   - Line chart showing spending over time
   - Predictions based on history
   - Anomaly detection

---

## Integration Points

### 1. Inspection Reports
- Auto-create budget items from findings
- Link budget items to specific findings
- Update costs based on inspection recommendations

### 2. Action Plans
- Sync action items to budget
- Map timeframes automatically
- Preserve cost estimates

### 3. Maintenance Tasks
- Link recurring maintenance to budget
- Track costs per maintenance event
- Generate budget items from maintenance schedule

### 4. Expenses
- Record actual spending
- Link expenses to budget items
- Receipt storage and tracking

---

## Existing Infrastructure

### Already Implemented ✅
- Database schema (`schema-budget.ts`) with budget_items, budget_categories, budget_goals, expenses
- BudgetService with CRUD operations
- BudgetTimelineScreen (React Native)
- Budget API client (`src/api/budget.ts`)
- Basic timeline view with timeframe grouping
- Sync from action items functionality

### Needs Enhancement 🔧
- Year-based planning (currently only timeframe-based)
- System category field on budget_items
- Multi-year forecast chart visualization
- Long-term (10-year) planning views
- Budget vs actual analysis
- Recurring item automation

## Implementation Phases

### Phase 1: Core Budget Planning (MVP) - ENHANCEMENT
- ✅ Database schema (exists, needs year/system_category fields)
- ✅ Basic budget item CRUD (exists, needs enhancements)
- ✅ Current year view (exists, needs enhancement)
- ✅ Simple list/timeline view (exists)
- ✅ Manual item creation (exists)
- **New:** Add year and system_category fields
- **New:** Enhanced form with system categories
- **Timeline:** 1-2 weeks

### Phase 2: Long-Term Forecasting
- Multi-year planning (2-10 years)
- Year-based budget items
- Basic forecast chart
- System category grouping
- **Timeline:** 2 weeks

### Phase 3: Visualization
- Tactical forecast chart (like image)
- Interactive chart features
- Budget vs actual charts
- Category breakdowns
- **Timeline:** 2-3 weeks

### Phase 4: Intelligence & Automation
- AI budget recommendations
- Auto-sync from inspection reports
- Recurring item automation
- Cost estimation improvements
- **Timeline:** 2-3 weeks

### Phase 5: Advanced Features
- Budget optimization suggestions
- Spending pattern analysis
- Mobile-optimized views
- Export/import functionality
- **Timeline:** 1-2 weeks

**Total Estimated Timeline:** 9-13 weeks

---

## Technical Considerations

### Performance
- Efficient queries for multi-year forecasts
- Caching for chart data
- Pagination for large item lists
- Indexed queries on year, category, status

### Data Integrity
- Validate year ranges (not too far in past/future)
- Ensure cost estimates are reasonable
- Prevent duplicate items
- Handle timezone issues for dates

### User Experience
- Responsive design (mobile-friendly)
- Fast chart rendering
- Smooth interactions (drag, hover, click)
- Clear visual hierarchy
- Accessible (WCAG compliance)

### Security
- Household access control (already implemented)
- Validate user permissions
- Sanitize user inputs
- Rate limiting on API endpoints

---

## Success Metrics

1. **Adoption:**
   - % of households using budget planning
   - Average items per household
   - Forecast horizon usage (1yr vs 10yr)

2. **Engagement:**
   - Frequency of budget updates
   - Items marked complete
   - Actual cost tracking usage

3. **Value:**
   - Budget accuracy (planned vs actual)
   - User satisfaction scores
   - Feature usage analytics

---

## Future Enhancements

1. **Contractor Integration:**
   - Request quotes from budget items
   - Track contractor bids
   - Schedule work directly

2. **Financing Options:**
   - Loan calculator for large projects
   - Payment plan suggestions
   - ROI calculations for improvements

3. **Market Data:**
   - Local cost averages
   - Material cost trends
   - Seasonal pricing adjustments

4. **Collaboration:**
   - Share budget with family members
   - Comment on items
   - Approval workflows

5. **Mobile App:**
   - Quick expense entry
   - Receipt scanning
   - Budget alerts/notifications

---

## Design Mockups (Conceptual)

### Dashboard Layout
```
┌─────────────────────────────────────────────────┐
│  Budget Planning                    [Add Item]  │
├─────────────────────────────────────────────────┤
│  [Current Year] [5-Year] [10-Year Forecast]    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 2024 Budget Overview                     │  │
│  │ Planned: $12,000 - $18,000               │  │
│  │ Actual: $8,500                           │  │
│  │ Remaining: $3,500 - $9,500               │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 10-Year Tactical Forecast                 │  │
│  │ [Stacked Bar Chart - like image]          │  │
│  │                                           │  │
│  │ 2024 2025 2026 2027 2028 2029 2030 ...   │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Upcoming This Year:                            │
│  • Maintain fireplace - $200-$400 - Q1         │
│  • Replace breakers - $500-$800 - Q2           │
│  • HVAC service - $200-$300 - Q3               │
└─────────────────────────────────────────────────┘
```

### Chart Visualization
```
Tactical Forecast (10 years)
$8M │                                    ████
    │                              ████  ████
$6M │                        ████  ████  ████
    │                  ████  ████  ████  ████
$4M │            ████  ████  ████  ████  ████
    │      ████  ████  ████  ████  ████  ████
$2M │ ████ ████  ████  ████  ████  ████  ████
    │ ████ ████  ████  ████  ████  ████  ████
$0  └──────────────────────────────────────────
    2024 2025 2026 2027 2028 2029 2030 2031 2032 2033

Legend:
███ Structural  ███ Electrical  ███ Plumbing  ███ HVAC
███ Roof        ███ Interior     ███ Exterior   ███ Other
```

---

## Conclusion

This feature provides homeowners with professional-grade budget and maintenance planning tools, enabling them to:
- Plan for both immediate needs and long-term capital expenditures
- Visualize spending across multiple years
- Track actual vs planned costs
- Make informed decisions about maintenance, repairs, and improvements
- Avoid financial surprises through proactive planning

The feature builds on existing infrastructure (budget tables, action items, maintenance tasks) while adding powerful visualization and forecasting capabilities that match industry best practices.
