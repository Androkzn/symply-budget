//
//  SymplyBudgetWidgetContent.swift
//  SymplyEcosystemWidget
//
//  Symply Budget (appKey "budget") home-screen widget content. Renders the
//  month-at-a-glance budget brief — money left this month (hero), spent vs.
//  budget with a progress bar, this month's savings + trend vs. last month,
//  top spending category, the next upcoming bill, and (medium/large) the
//  latest AI "Budget Wins" insight.
//
//  Built ONLY from the shared Symply Widget kit primitives (SymplyCard /
//  SymplyHeader / SymplyStatTile / SymplyListRow / SymplyProgressBar /
//  SymplyInsightBanner / SymplyEmptyState) so every app's widget shares one
//  visual rhythm. Data comes from the shared App Group under keys prefixed
//  `widget_budget_` (written by the RN app).
//

import SwiftUI
import WidgetKit

// MARK: - App Group data contract (written by the RN app)

/// The next upcoming bill in the current month.
struct BudgetNextBill: Codable, Hashable {
    let name: String
    let amountCents: Int
    /// ISO-8601 (or bare `YYYY-MM-DD`) due date. Optional — undated bills omit it.
    let due: String?
}

/// The month-at-a-glance budget summary the widget renders. Decoded from the
/// App Group JSON at `widget_budget_summary`. JSON is snake_case
/// (`remaining_cents`, `spent_cents`, …) and decodes with `.convertFromSnakeCase`.
struct BudgetSummary: Codable, Hashable {
    let remainingCents: Int
    let spentCents: Int
    let budgetCents: Int
    /// ISO-4217 code (e.g. "USD"). Falls back to USD when missing/empty.
    let currency: String?
    let topCategory: String?
    let nextBill: BudgetNextBill?
    /// This month's net savings (income − monthly payments − spendings), in cents.
    /// From `SavingsOverview.netSavings`. Nil on minimal-budget / savings-disabled
    /// households, or an older app build that predates this field.
    let savingsCents: Int?
    /// Prior month's net savings, in cents — powers the "vs last month" trend.
    /// Nil when there is no prior-month data point yet (e.g. a brand-new household).
    let savingsPrevCents: Int?
    /// Full-year projection under the household's chosen Projection method
    /// (Savings → Projection → "Set as household default"), in cents. Nil on
    /// minimal-budget / savings-disabled households, or an older app build.
    let projectedYearEndCents: Int?
    /// Server-composed AI message (from `BudgetEncouragement`). One of
    /// "celebrate" | "positive" | "neutral" | "watch" | "tip" — an unknown value
    /// degrades to the neutral/brand tint instead of failing decode.
    let insightTone: String?
    let insightMessage: String?
    let insightEmoji: String?

    /// App Group key the RN app writes this payload under.
    static let appGroupKey = "widget_budget_summary"

    /// Load the latest summary from the shared App Group. Returns nil when signed
    /// out or when no summary has been written yet (→ empty state).
    ///
    /// Gated on `isSignedIn` (household present), NOT `isAuthenticated`: the product
    /// JWT is never written to the App Group, so requiring `auth_token` here left the
    /// widget permanently stuck on the empty state even for signed-in users. The
    /// summary is household-scoped and cleared on logout, so its presence alone is a
    /// safe signal.
    static func load(from defaults: UserDefaults? = WidgetStore.defaults) -> BudgetSummary? {
        guard WidgetStore.isSignedIn(in: defaults),
              let data = defaults?.data(forKey: appGroupKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(BudgetSummary.self, from: data)
    }

    /// Illustrative content for the widget gallery / previews (never real data) so
    /// the picker shows what each size looks like when populated.
    static let sample: BudgetSummary = {
        let due = ISO8601DateFormatter().string(
            from: Calendar.current.date(byAdding: .day, value: 2, to: Date()) ?? Date()
        )
        return BudgetSummary(
            remainingCents: 84_200,
            spentCents: 165_800,
            budgetCents: 250_000,
            currency: "USD",
            topCategory: "Groceries",
            nextBill: BudgetNextBill(name: "Electricity", amountCents: 12_000, due: due),
            savingsCents: 42_000,
            savingsPrevCents: 31_500,
            projectedYearEndCents: 420_000,
            insightTone: "positive",
            insightMessage: "You're on pace to save $80 more than last month — nice work staying under budget.",
            insightEmoji: "🎉"
        )
    }()
}

// MARK: - Currency formatting

enum BudgetFormat {
    /// Compact currency string with no cents (widgets are tight on width).
    static func money(_ cents: Int, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        let value = Double(cents) / 100.0
        return formatter.string(from: NSNumber(value: value)) ?? "\(Int(value.rounded()))"
    }
}

// MARK: - Render-ready derived values

/// Effective, formatted values for a summary — keeps the views declarative and
/// tolerant of missing optional fields.
struct BudgetBrief {
    let summary: BudgetSummary

    var currency: String {
        if let c = summary.currency, !c.isEmpty { return c }
        return "USD"
    }

    // Remaining (hero) — semantic tint: overspent → urgent red, else brand accent.
    var overspent: Bool { summary.remainingCents < 0 }
    var remaining: String { BudgetFormat.money(summary.remainingCents, currency: currency) }
    var remainingCaption: String { overspent ? "Over budget" : "Left this month" }
    var remainingTint: Color { overspent ? WidgetTheme.urgentRed : BrandTokens.primary }

    // Spent vs. budget — tint ramps as spending nears/exceeds the budget.
    var spent: String { BudgetFormat.money(summary.spentCents, currency: currency) }
    var budget: String { BudgetFormat.money(summary.budgetCents, currency: currency) }
    var spentCaption: String { "of \(budget) spent" }
    var spentTint: Color {
        guard summary.budgetCents > 0 else { return BrandTokens.primary }
        let ratio = Double(summary.spentCents) / Double(summary.budgetCents)
        if ratio >= 1 { return WidgetTheme.urgentRed }
        if ratio >= 0.9 { return WidgetTheme.amber }
        return BrandTokens.primary
    }

    var topCategory: String? {
        guard let t = summary.topCategory, !t.isEmpty else { return nil }
        return t
    }

    // Spend progress — fraction of budget consumed, clamped for the progress bar
    // but the label reports the true (possibly >100%) percentage.
    var spentRatio: Double {
        guard summary.budgetCents > 0 else { return 0 }
        return Double(summary.spentCents) / Double(summary.budgetCents)
    }
    var spentRatioLabel: String { "\(Int((spentRatio * 100).rounded()))% used" }

    // Savings — this month's net (income − payments − spendings), with a
    // trend vs. the prior month. Absent entirely on minimal-budget households.
    var savingsCents: Int? { summary.savingsCents }
    var hasSavings: Bool { savingsCents != nil }
    var savings: String { BudgetFormat.money(savingsCents ?? 0, currency: currency) }
    var savingsCaption: String { "Saved this month" }
    var savingsTint: Color { (savingsCents ?? 0) >= 0 ? WidgetTheme.green : WidgetTheme.urgentRed }

    /// "+18% vs last month" / "-6% vs last month" style trend, computed against
    /// the prior month's net. Falls back to an absolute-dollar phrasing when the
    /// prior month was exactly $0 (a percentage vs. zero is undefined).
    var savingsTrendLabel: String? {
        guard let current = savingsCents, let prev = summary.savingsPrevCents else { return nil }
        if prev == 0 {
            guard current != 0 else { return nil }
            let delta = BudgetFormat.money(current, currency: currency)
            return current > 0 ? "\(delta) more than last month" : "\(delta) vs last month"
        }
        let deltaPct = Int(((Double(current - prev) / Double(abs(prev))) * 100).rounded())
        if deltaPct == 0 { return "Flat vs last month" }
        let sign = deltaPct > 0 ? "+" : ""
        return "\(sign)\(deltaPct)% vs last month"
    }
    var savingsTrendUp: Bool {
        guard let current = savingsCents, let prev = summary.savingsPrevCents else { return true }
        return current >= prev
    }
    /// Neutral piggy-bank glyph when there is no prior-month figure to compare
    /// against — an up/down arrow with no trend label would imply a trend we
    /// don't actually have.
    var savingsTrendIcon: String {
        guard summary.savingsPrevCents != nil else { return "banknote.fill" }
        return savingsTrendUp ? "arrow.up.right" : "arrow.down.right"
    }

    // Projected year-end — full-year extrapolation under the household's
    // chosen Projection method. Absent entirely on minimal-budget households,
    // same as savings above.
    var projectedYearEndCents: Int? { summary.projectedYearEndCents }
    var hasProjection: Bool { projectedYearEndCents != nil }
    var projectedYearEnd: String { BudgetFormat.money(projectedYearEndCents ?? 0, currency: currency) }

    // AI insight (server-composed "Budget Wins" copy) — rendered verbatim.
    var insightMessage: String? {
        guard let m = summary.insightMessage, !m.isEmpty else { return nil }
        return m
    }
    var insightEmoji: String? { summary.insightEmoji }
    var insightTint: Color {
        switch summary.insightTone {
        case "celebrate": return WidgetTheme.green
        case "watch": return WidgetTheme.amber
        default: return BrandTokens.primary
        }
    }

    var nextBill: BudgetNextBill? { summary.nextBill }

    var nextBillDueLabel: String? {
        guard let due = summary.nextBill?.due, let date = WidgetDate.parse(due) else { return nil }
        return WidgetDueLabel.short(for: date)
    }

    var nextBillAmount: String? {
        guard let bill = summary.nextBill else { return nil }
        return BudgetFormat.money(bill.amountCents, currency: currency)
    }

    /// "Tomorrow · $120" style trailing detail for the bill row.
    var nextBillDetail: String? {
        switch (nextBillDueLabel, nextBillAmount) {
        case let (due?, amount?): return "\(due) · \(amount)"
        case let (due?, nil): return due
        case let (nil, amount?): return amount
        default: return nil
        }
    }
}

// MARK: - Content view

/// Renders the Symply Budget widget for `systemSmall` / `systemMedium` /
/// `systemLarge` from the decoded summary (or `nil` → empty state). Wrap the
/// result in the app's timeline entry view (which supplies `widgetURL` /
/// container background).
struct SymplyBudgetWidgetContent: View {
    let summary: BudgetSummary?
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private static let title = "Budget"        // app short name
    private static let icon = "dollarsign.circle.fill"
    /// Real Budget app icon — see `SymplyHeader.logoImageName`. Falls back to
    /// `icon` (SF Symbol) automatically if the asset is ever missing.
    private static let logo = "BudgetAppIcon"

    var body: some View {
        SymplyCard {
            if let summary {
                switch family {
                case .systemSmall:
                    small(BudgetBrief(summary: summary))
                case .systemLarge:
                    large(BudgetBrief(summary: summary))
                default:
                    medium(BudgetBrief(summary: summary))
                }
            } else {
                SymplyEmptyState(icon: "wallet.pass.fill", message: "Sign in to track your budget")
            }
        }
    }

    // MARK: Small — hero remaining, thin spend progress, one supporting row.

    @ViewBuilder
    private func small(_ brief: BudgetBrief) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(icon: Self.icon, title: Self.title, logoImageName: Self.logo)

            SymplyStatTile(
                value: brief.remaining,
                caption: brief.remainingCaption,
                tint: brief.remainingTint
            )

            SymplyProgressBar(progress: brief.spentRatio, tint: brief.spentTint)

            Spacer(minLength: 0)

            if let bill = brief.nextBill {
                SymplyListRow(
                    icon: "creditcard.fill",
                    text: bill.name,
                    detail: brief.nextBillDetail
                )
            } else if let category = brief.topCategory {
                SymplyListRow(
                    icon: "chart.pie.fill",
                    text: category,
                    detail: "Top spend"
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Medium — two stat tiles, spend progress, savings + trend, AI insight.

    @ViewBuilder
    private func medium(_ brief: BudgetBrief) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.tightGap) {
            SymplyHeader(icon: Self.icon, title: Self.title, trailing: brief.budget, logoImageName: Self.logo)

            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: brief.remaining,
                    caption: brief.remainingCaption,
                    tint: brief.remainingTint
                )
                SymplyStatTile(
                    value: brief.spent,
                    caption: brief.spentCaption,
                    tint: brief.spentTint
                )
            }
            .padding(.bottom, SymplyLayout.tightGap)

            HStack(spacing: SymplyLayout.gap) {
                SymplyProgressBar(progress: brief.spentRatio, tint: brief.spentTint)
                Text(brief.spentRatioLabel)
                    .font(BrandTokens.font(10, .semibold))
                    .foregroundStyle(brief.spentTint)
                    .lineLimit(1)
                    .fixedSize()
            }

            if brief.hasSavings {
                SymplyListRow(
                    icon: brief.savingsTrendIcon,
                    text: "Saved \(brief.savings)",
                    detail: brief.savingsTrendLabel,
                    tint: brief.savingsTint
                )
            }
            if brief.hasProjection {
                SymplyListRow(
                    icon: "chart.line.uptrend.xyaxis",
                    text: "Projected year-end",
                    detail: brief.projectedYearEnd
                )
            }

            Spacer(minLength: 0)

            bottomLine(brief)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Large — full dashboard: 2×2 figures, progress, bill, AI insight banner.

    @ViewBuilder
    private func large(_ brief: BudgetBrief) -> some View {
        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(icon: Self.icon, title: Self.title, trailing: brief.spentRatioLabel, logoImageName: Self.logo)

            SymplyProgressBar(progress: brief.spentRatio, tint: brief.spentTint, height: 8)

            VStack(spacing: SymplyLayout.gap) {
                HStack(spacing: SymplyLayout.gap) {
                    SymplyStatTile(value: brief.remaining, caption: brief.remainingCaption, tint: brief.remainingTint)
                    SymplyStatTile(value: brief.spent, caption: brief.spentCaption, tint: brief.spentTint)
                }
                HStack(spacing: SymplyLayout.gap) {
                    SymplyStatTile(value: brief.budget, caption: "Budget this month", tint: BrandTokens.primary)
                    if brief.hasSavings {
                        SymplyStatTile(
                            value: brief.savings,
                            caption: brief.savingsTrendLabel ?? brief.savingsCaption,
                            tint: brief.savingsTint
                        )
                    }
                }
            }

            if let category = brief.topCategory {
                SymplyListRow(icon: "chart.pie.fill", text: "Top: \(category)", tint: brief.spentTint)
            }
            if let bill = brief.nextBill {
                SymplyListRow(icon: "creditcard.fill", text: bill.name, detail: brief.nextBillDetail)
            }
            if brief.hasProjection {
                SymplyListRow(
                    icon: "chart.line.uptrend.xyaxis",
                    text: "Projected year-end",
                    detail: brief.projectedYearEnd
                )
            }

            Spacer(minLength: 0)

            if let message = brief.insightMessage {
                SymplyInsightBanner(emoji: brief.insightEmoji, message: message, tint: brief.insightTint, lineLimit: 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Medium's single closing line — the AI insight when the backend has
    /// produced one this month, else the same bill/category fallback the
    /// widget always showed. Never both: medium has room for exactly one.
    @ViewBuilder
    private func bottomLine(_ brief: BudgetBrief) -> some View {
        if let message = brief.insightMessage {
            HStack(alignment: .top, spacing: SymplyLayout.tightGap) {
                Text((brief.insightEmoji?.isEmpty == false) ? brief.insightEmoji! : "✨")
                    .font(.system(size: 10))
                Text(message)
                    .font(BrandTokens.font(10, .medium))
                    .foregroundStyle(BrandTokens.primaryText(scheme).opacity(0.7))
                    .lineLimit(1)
            }
        } else if let bill = brief.nextBill {
            SymplyListRow(icon: "creditcard.fill", text: bill.name, detail: brief.nextBillDetail)
        } else if let category = brief.topCategory {
            SymplyListRow(icon: "chart.pie.fill", text: category, detail: "Top spend")
        }
    }
}
