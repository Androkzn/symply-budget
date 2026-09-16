//
//  SymplyBudgetWatchView.swift
//  SymplyEcosystemWatch
//
//  Symply Budget — glanceable watch face. A single scrollable card built ONLY
//  from the shared Symply kit (SymplyCard/Header/StatTile/ListRow/EmptyState) so
//  every app's watch surface reads as one product line.
//
//  Data source: the shared App Group (AppGroup.defaults), key "watch_budget_today"
//  — a JSON blob (snake_case) that whatever runs on the phone syncs across via
//  WatchConnectivity. No dedicated sync exists yet, so this view degrades to a
//  SymplyEmptyState whenever the key is absent or unreadable.
//

import SwiftUI

// MARK: - Model

/// Today's budget snapshot, decoded from AppGroup key "watch_budget_today".
/// All monetary fields are plain numbers in the household currency.
struct BudgetToday: Codable {
    /// Remaining to spend this month — the hero number.
    let remaining: Double
    /// Amount already spent in the current period.
    let spent: Double
    /// Total budget for the current period.
    let budget: Double
    /// ISO 4217 currency code (e.g. "USD"); falls back to the device locale.
    let currencyCode: String?
    /// Human label for the current period (e.g. "July").
    let periodLabel: String?
    /// Next upcoming bill — name / amount / due label. All optional.
    let nextBillName: String?
    let nextBillAmount: Double?
    let nextBillDue: String?
    /// Full-year projection under the household's chosen Projection method.
    /// Nil on minimal-budget / savings-disabled households, or an older phone build.
    let projectedYearEnd: Double?

    private enum CodingKeys: String, CodingKey {
        case remaining
        case spent
        case budget
        case currencyCode = "currency_code"
        case periodLabel = "period_label"
        case nextBillName = "next_bill_name"
        case nextBillAmount = "next_bill_amount"
        case nextBillDue = "next_bill_due"
        case projectedYearEnd = "projected_year_end"
    }

    /// Reads and decodes the snapshot from the shared App Group.
    /// Returns `nil` when the key is missing or the payload can't be decoded,
    /// so the view can fall back to `SymplyEmptyState`.
    static func load() -> BudgetToday? {
        guard let data = AppGroup.defaults.data(forKey: "watch_budget_today") else {
            return nil
        }
        return try? JSONDecoder().decode(BudgetToday.self, from: data)
    }
}

// MARK: - View

struct SymplyBudgetWatchView: View {
    /// App short name shown in the header.
    private let shortName = "Budget"

    private let snapshot = BudgetToday.load()

    var body: some View {
        ScrollView {
            SymplyCard {
                if let snapshot {
                    content(for: snapshot)
                } else {
                    SymplyEmptyState(
                        icon: Ionicon.symbol("wallet"),
                        message: "No budget yet.\nOpen Symply Budget on your iPhone."
                    )
                    .frame(minHeight: 120)
                }
            }
        }
    }

    @ViewBuilder
    private func content(for data: BudgetToday) -> some View {
        // Over budget when nothing (or less than nothing) is left to spend.
        let overspent = data.remaining < 0
        let heroTint: Color = overspent ? Self.warning : BrandTokens.primary

        VStack(alignment: .leading, spacing: SymplyLayout.gap) {
            SymplyHeader(
                icon: Ionicon.symbol("wallet"),
                title: shortName,
                trailing: data.periodLabel
            )

            // Hero — remaining this month.
            SymplyStatTile(
                value: Self.currency(data.remaining, code: data.currencyCode),
                caption: overspent ? "Over budget" : remainingCaption(data),
                tint: heroTint
            )

            // Spent vs budget.
            HStack(spacing: SymplyLayout.gap) {
                SymplyStatTile(
                    value: Self.currency(data.spent, code: data.currencyCode),
                    caption: "Spent"
                )
                SymplyStatTile(
                    value: Self.currency(data.budget, code: data.currencyCode),
                    caption: "Budget"
                )
            }

            // Projected year-end — under the household's chosen Projection method.
            if let projectedYearEnd = data.projectedYearEnd {
                SymplyStatTile(
                    value: Self.currency(projectedYearEnd, code: data.currencyCode),
                    caption: "Projected year-end"
                )
            }

            // Next bill.
            if let name = data.nextBillName {
                SymplyListRow(
                    icon: Ionicon.symbol("card"),
                    text: name,
                    detail: nextBillDetail(data)
                )
            }
        }
    }

    // MARK: - Copy helpers

    private func remainingCaption(_ data: BudgetToday) -> String {
        if let period = data.periodLabel, !period.isEmpty {
            return "Left in \(period)"
        }
        return "Left this month"
    }

    private func nextBillDetail(_ data: BudgetToday) -> String? {
        var parts: [String] = []
        if let amount = data.nextBillAmount {
            parts.append(Self.currency(amount, code: data.currencyCode))
        }
        if let due = data.nextBillDue, !due.isEmpty {
            parts.append(due)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Formatting

    /// Compact, glanceable currency (no fraction digits on the small screen).
    private static func currency(_ value: Double, code: String?) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = 0
        if let code, !code.isEmpty {
            formatter.currencyCode = code
        }
        return formatter.string(from: NSNumber(value: value)) ?? "\(Int(value))"
    }

    /// Local semantic accent for the over-budget state (self-contained; brand
    /// accent stays `BrandTokens.primary` for the normal case).
    private static let warning = Color(red: 1.0, green: 0.231, blue: 0.188) // #FF3B30
}

#Preview {
    SymplyBudgetWatchView()
}
