import DesignSystem
import SwiftUI
#if os(iOS)
import UIKit
#endif

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

#if os(iOS)
extension View {
    func phonePopover<PopoverContent: View>(
        isPresented: Binding<Bool>,
        anchor: UnitPoint = .center,
        @ViewBuilder content: @escaping () -> PopoverContent
    ) -> some View {
        background {
            PhonePopoverPresenter(isPresented: isPresented, anchor: anchor, content: content)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// Anchored iOS popover host with the system pointer disabled.
private struct PhonePopoverPresenter<PopoverContent: View>: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let anchor: UnitPoint
    let content: () -> PopoverContent

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = .clear
        controller.view.isOpaque = false
        controller.view.isUserInteractionEnabled = false
        controller.view.accessibilityElementsHidden = true
        return controller
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        context.coordinator.binding = $isPresented
        if isPresented {
            context.coordinator.present(AnyView(content()), anchor: anchor, from: controller)
        } else {
            context.coordinator.dismiss()
        }
    }

    static func dismantleUIViewController(_ controller: UIViewController, coordinator: Coordinator) {
        coordinator.dismiss(animated: false)
    }

    @MainActor
    final class Coordinator: NSObject, UIPopoverPresentationControllerDelegate {
        var binding: Binding<Bool>?
        private var hostingController: UIHostingController<AnyView>?

        func present(_ content: AnyView, anchor: UnitPoint, from source: UIViewController) {
            guard source.viewIfLoaded?.window != nil else { return }

            if let hostingController, hostingController.presentingViewController != nil {
                hostingController.rootView = content
                hostingController.popoverPresentationController?.sourceRect = sourceRect(in: source.view.bounds, anchor: anchor)
                updatePreferredSize(of: hostingController, source: source)
                return
            }
            hostingController = nil

            let hosted = UIHostingController(rootView: content)
            hosted.modalPresentationStyle = .popover
            hosted.view.backgroundColor = raisedColor
            hosted.view.isOpaque = false
            hosted.view.layer.cornerRadius = 14
            hosted.view.clipsToBounds = true
            hosted.popoverPresentationController?.sourceView = source.view
            hosted.popoverPresentationController?.sourceRect = sourceRect(in: source.view.bounds, anchor: anchor)
            hosted.popoverPresentationController?.permittedArrowDirections = []
            hosted.popoverPresentationController?.canOverlapSourceViewRect = true
            hosted.popoverPresentationController?.backgroundColor = raisedColor
            hosted.popoverPresentationController?.delegate = self
            updatePreferredSize(of: hosted, source: source)
            hostingController = hosted

            guard let presenter = topPresenter(from: source), presenter.presentedViewController == nil else {
                hostingController = nil
                return
            }
            presenter.present(hosted, animated: true)
        }

        func dismiss(animated: Bool = true) {
            guard let hostingController else { return }
            guard hostingController.presentingViewController != nil else {
                self.hostingController = nil
                return
            }
            hostingController.dismiss(animated: animated) { [weak self, weak hostingController] in
                guard self?.hostingController === hostingController else { return }
                self?.hostingController = nil
            }
        }

        func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle { .none }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            binding?.wrappedValue = false
            hostingController = nil
        }

        func popoverPresentationControllerDidDismissPopover(_ popoverPresentationController: UIPopoverPresentationController) {
            binding?.wrappedValue = false
            hostingController = nil
        }

        private func sourceRect(in bounds: CGRect, anchor: UnitPoint) -> CGRect {
            let x = bounds.minX + bounds.width * min(max(anchor.x, 0), 1)
            let y = bounds.minY + bounds.height * min(max(anchor.y, 0), 1)
            return CGRect(x: x, y: y, width: 1, height: 1)
        }

        private func updatePreferredSize(of controller: UIHostingController<AnyView>, source: UIViewController) {
            let size = source.viewIfLoaded?.window?.bounds.size ?? CGSize(width: 390, height: 844)
            let limit = CGSize(width: max(1, min(360, size.width - 32)), height: max(1, size.height - 48))
            let fitted = controller.sizeThatFits(in: limit)
            controller.preferredContentSize = CGSize(width: min(max(1, fitted.width), limit.width),
                                                     height: min(max(1, fitted.height), limit.height))
        }

        private func topPresenter(from source: UIViewController) -> UIViewController? {
            var presenter = source
            while let parent = presenter.parent { presenter = parent }
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            return presenter.viewIfLoaded?.window == nil ? nil : presenter
        }

        private var raisedColor: UIColor {
            UIColor { traits in
                if traits.userInterfaceStyle == .dark {
                    UIColor(red: CGFloat(39) / 255, green: CGFloat(33) / 255,
                            blue: CGFloat(45) / 255, alpha: 1)
                } else {
                    .white
                }
            }
        }
    }
}
#endif
