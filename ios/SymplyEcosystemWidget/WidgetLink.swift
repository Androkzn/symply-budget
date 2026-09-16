//
//  WidgetLink.swift
//  SymplyEcosystemWidget
//
//  Builds `simplehouse://` deep links from the insight's CTA route (an
//  expo-router path such as "/tasks"), so tapping the widget lands on the
//  matching screen. Falls back to the app root.
//

import Foundation

enum WidgetLink {
    static let scheme = "simplehouse"

    /// Deep link for an expo-router route + optional params.
    static func url(route: String?, params: [String: String]? = nil) -> URL {
        let raw = (route ?? "/").trimmingCharacters(in: .whitespaces)
        let path = raw.hasPrefix("/") ? String(raw.dropFirst()) : raw
        var string = "\(scheme)://\(path)"
        if let params, !params.isEmpty {
            let query = params
                .map { key, value in
                    let k = key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? key
                    let v = value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
                    return "\(k)=\(v)"
                }
                .joined(separator: "&")
            string += "?\(query)"
        }
        return URL(string: string) ?? URL(string: "\(scheme)://")!
    }

    /// Primary tap target for the widget: the insight CTA, else the tasks list
    /// when there is urgent work, else the app root.
    static func primary(for content: WidgetContent) -> URL {
        if let cta = content.insight?.cta {
            return url(route: cta.route, params: cta.params)
        }
        if !content.tasks.isEmpty {
            return url(route: "/tasks")
        }
        return url(route: "/")
    }

    static let tasks = url(route: "/tasks")
}
