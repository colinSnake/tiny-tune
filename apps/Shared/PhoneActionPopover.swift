import DesignSystem
import SwiftUI

/// Shared iOS presentation for anchored menus and confirmations.
struct PhonePopoverSurface<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .vertical) {
            content().fixedSize(horizontal: false, vertical: true)
            ScrollView { content() }
        }
        .fixedSize(horizontal: true, vertical: false)
        .background(TuneTheme.raised)
        .presentationBackground(TuneTheme.raised)
        .presentationCompactAdaptation(.popover)
        .environment(\.locale, AppLanguage.locale)
    }
}

struct PhoneActionPopover<Rows: View>: View {
    @Environment(\.dynamicTypeSize) private var textSize
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        PhonePopoverSurface {
            if textSize.isAccessibilitySize {
                menu.frame(width: 288)
            } else {
                BoundedWidth(minWidth: 130, maxWidth: 172) { menu }
            }
        }
    }

    private var menu: some View {
        Grid(verticalSpacing: 0, content: rows)
            .padding(.vertical, 6)
            .padding(.horizontal, 15)
    }

    private struct BoundedWidth: Layout {
        let minWidth: CGFloat
        let maxWidth: CGFloat

        func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
            guard let rows = subviews.first else { return .zero }
            // Only visible labels determine width. Short menus keep their insets; long ones can wrap.
            let idealWidth = rows.sizeThatFits(.unspecified).width
            let width = min(max(idealWidth, minWidth), maxWidth)
            let height = rows.sizeThatFits(ProposedViewSize(width: width, height: proposal.height)).height
            return CGSize(width: width, height: height)
        }

        func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
            subviews.first?.place(at: CGPoint(x: bounds.midX, y: bounds.midY), anchor: .center,
                                  proposal: ProposedViewSize(bounds.size))
        }
    }
}

struct PhonePopoverDivider: View {
    var body: some View {
        Divider()
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .gridCellUnsizedAxes(.horizontal)
    }
}

struct PhonePopoverAction: View {
    let title: LocalizedStringKey
    let symbol: String?
    let role: ButtonRole?
    // Nil indicates a command, rather than one of a group of selectable options.
    let isSelected: Bool?
    let action: () -> Void
    @ScaledMetric(relativeTo: .subheadline) private var labelSize: CGFloat = 14
    @ScaledMetric(relativeTo: .subheadline) private var iconSize: CGFloat = 13

    init(_ title: LocalizedStringKey, symbol: String? = nil, role: ButtonRole? = nil,
         isSelected: Bool? = nil, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.role = role
        self.isSelected = isSelected
        self.action = action
    }

    var body: some View {
        let destructive = role == .destructive
        Button(role: role, action: action) {
            HStack(spacing: 9) {
                if let symbol {
                    icon(symbol).foregroundStyle(destructive ? TuneTheme.problem : TuneTheme.secondary)
                }
                Text(title)
                    .font(.system(size: labelSize, weight: .medium))
                    .foregroundStyle(destructive ? TuneTheme.problem : TuneTheme.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let isSelected {
                    icon("checkmark").foregroundStyle(TuneTheme.accent).opacity(isSelected ? 1 : 0)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected == true ? .isSelected : [])
    }

    private func icon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: iconSize, weight: .medium))
            .frame(width: iconSize + 5)
            .accessibilityHidden(true)
    }
}
