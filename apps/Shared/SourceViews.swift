import DesignSystem
import Domain
import Library
import SwiftUI

struct ImportSheet: View {
    let app: AppState
    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @ScaledMetric(relativeTo: .headline) private var phoneTitleSize: CGFloat = 20
    @ScaledMetric(relativeTo: .subheadline) private var phoneBodySize: CGFloat = 14
    @State private var prefersLargeImportSheet = false
    #endif

    var body: some View {
        if let flow = app.flow {
            #if os(iOS)
            phoneBody(flow)
            #else
            macBody(flow)
            #endif
        }
    }

    private func title(_ flow: ImportFlow) -> LocalizedStringKey {
        flow.restoringRemoved ? "Restore Removed Songs" : (flow.replaces == nil ? "Import Music" : "Reconnect Source")
    }

    private func showsConfirmation(_ flow: ImportFlow) -> Bool {
        flow.canCommit || (flow.restoringRemoved && flow.change?.recoverable.isEmpty == false && !flow.requiresRescan)
    }

    private func dismissalLabel(_ flow: ImportFlow) -> LocalizedStringKey {
        if flow.scanning || flow.canCommit || (flow.restoringRemoved && flow.error == nil && flow.change?.recoverable.isEmpty == false) {
            return "Cancel"
        }
        return "Done"
    }

    #if os(iOS)
    private func phoneBody(_ flow: ImportFlow) -> some View {
        let compactDetent = phoneImportDetent(flow)
        let needsLargeDetent = textSize.isAccessibilitySize || verticalSizeClass == .compact
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title(flow))
                        .font(.system(size: phoneTitleSize, weight: .bold))
                        .accessibilityAddTraits(.isHeader)
                    if flow.error == nil, flow.change?.isFirstImport == true, flow.canCommit {
                        Text("Review complete. Confirm to add the songs to your library.")
                            .foregroundStyle(TuneTheme.secondary)
                    }
                }
                HStack(spacing: 9) {
                    Image(systemName: "folder")
                        .foregroundStyle(TuneTheme.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: flow.name)
                        .fontWeight(.semibold)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TuneTheme.canvas, in: .rect(cornerRadius: 12))
                results(for: flow)
                if flow.change?.isFirstImport == true, flow.canCommit {
                    Text("Original files won’t be moved or modified.")
                        .font(.footnote).foregroundStyle(TuneTheme.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Button(dismissalLabel(flow), action: app.cancelFlow)
                    .fontWeight(.medium)
                    .frame(minHeight: 44, alignment: .leading)
                    .keyboardShortcut(.cancelAction)
                    .disabled(flow.committing)
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 20)
            .background(TuneTheme.raised)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsConfirmation(flow) {
                VStack(alignment: .leading, spacing: 6) {
                    if flow.change?.isFirstImport == true, flow.error == nil, !textSize.isAccessibilitySize {
                        Text("Only indexed on this device. Your music isn’t uploaded.")
                            .font(.footnote).foregroundStyle(TuneTheme.secondary)
                    }
                    confirmButton(flow).buttonStyle(PhoneSheetPrimaryButton(labelSize: phoneBodySize))
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(TuneTheme.raised)
            }
        }
        .font(.system(size: phoneBodySize))
        .foregroundStyle(TuneTheme.primary)
        .tint(TuneTheme.accent)
        .presentationDetents(needsLargeDetent ? [.large] : [compactDetent, .large], selection: Binding(
            get: { needsLargeDetent || prefersLargeImportSheet ? .large : compactDetent },
            set: { if !needsLargeDetent { prefersLargeImportSheet = $0 == .large } }
        ))
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(TuneTheme.raised)
        .interactiveDismissDisabled(flow.committing)
    }

    private func phoneImportDetent(_ flow: ImportFlow) -> PresentationDetent {
        let hasReview = flow.canCommit || flow.restoringRemoved || (flow.draft?.totalSkipped ?? 0) > 0
        return flow.change != nil && hasReview ? .fraction(0.58) : .fraction(0.42)
    }

    private func phoneFirstImportSummary(added: Int, skipped: Int) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) {
                stat("Songs ready to import", added, fixed: true)
                stat("Items to skip", skipped, fixed: true)
            }
            VStack(alignment: .leading, spacing: 8) {
                stat("Songs ready to import", added)
                stat("Items to skip", skipped)
            }
        }
        .accessibilityElement(children: .contain)
    }
    #else
    private func macBody(_ flow: ImportFlow) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "folder.badge.plus")
                    .font(.title2).foregroundStyle(TuneTheme.accent)
                    .frame(width: 44, height: 44)
                    .background(TuneTheme.subtle, in: .rect(cornerRadius: 10))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title(flow))
                        .font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(flow.name).font(.subheadline).foregroundStyle(TuneTheme.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) { results(for: flow) }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
            }
            .frame(minHeight: flow.scanning ? 130 : 160)
            Divider()
            HStack {
                Spacer()
                Button(dismissalLabel(flow), action: app.cancelFlow)
                    .keyboardShortcut(.cancelAction)
                    .disabled(flow.committing)
                if showsConfirmation(flow) {
                    if flow.change?.isFirstImport == true {
                        confirmButton(flow)
                            .buttonStyle(TunePrimaryButton())
                            .opacity(flow.committing ? 0.7 : 1)
                    } else {
                        confirmButton(flow)
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .controlSize(.large)
            .padding(16)
        }
        .background(TuneTheme.raised)
        .foregroundStyle(TuneTheme.primary)
        .tint(TuneTheme.accent)
        .frame(width: 540, height: macHeight(flow))
    }
    #endif

    @ViewBuilder private func results(for flow: ImportFlow) -> some View {
        if flow.scanning {
            ProgressView("Checking music files…")
            Text("\(flow.progress.checked) checked · \(flow.progress.accepted) playable")
                .foregroundStyle(TuneTheme.secondary)
        }
        if let draft = flow.draft, let change = flow.change {
            if flow.restoringRemoved {
                recoverySummary(change, flow: flow)
            } else if change.isFirstImport {
                #if os(iOS)
                phoneFirstImportSummary(added: change.added, skipped: draft.totalSkipped)
                #else
                firstImportSummary(added: change.added, skipped: draft.totalSkipped)
                #endif
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 8) { stats(change, draft) }
                    VStack(alignment: .leading, spacing: 8) { stats(change, draft) }
                }
            }
            if !change.missing.isEmpty {
                Text("Missing songs leave the playback list. Rescan after returning the files to restore them.")
                    .font(.subheadline).foregroundStyle(TuneTheme.secondary)
            }
            if !change.unplayable.isEmpty {
                Text("Songs that cannot be decoded leave the playback list. Repair or replace the files and rescan to restore them.")
                    .font(.subheadline).foregroundStyle(TuneTheme.secondary)
            }
            if let reconnect = change.reconnect { reconnectSummary(reconnect) }
            if !flow.restoringRemoved, !flow.canCommit, flow.error == nil {
                (draft.audio.isEmpty ? Text("No playable music was found in this folder.") : Text("No changes to apply."))
                    .foregroundStyle(TuneTheme.secondary)
            }
            if draft.totalSkipped > 0 {
                #if os(iOS)
                DisclosureGroup("View skipped reasons") { skippedReasons(draft).padding(.top, 10) }
                    .font(.subheadline)
                    .frame(minHeight: 44)
                #else
                Text("Skipped items").font(.headline).accessibilityAddTraits(.isHeader)
                skippedReasons(draft)
                #endif
            }
        }
        if let error = flow.error {
            Label { Text(error) } icon: { Image(systemName: "exclamationmark.circle") }
                .foregroundStyle(TuneTheme.problem)
        }
    }

    private func skippedReasons(_ draft: ImportDraft) -> some View {
        ForEach(SkipReason.allCases, id: \.self) { reason in
            if let info = draft.skipped[reason] {
                DisclosureGroup {
                    ForEach(Array(info.examples.enumerated()), id: \.offset) { _, name in
                        Text(verbatim: name).font(.caption).foregroundStyle(TuneTheme.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } label: {
                    HStack { Text(reason.title); Spacer(); Text(info.count, format: .number).monospacedDigit() }
                }
            }
        }
    }

    #if os(macOS)
    private func macHeight(_ flow: ImportFlow) -> CGFloat {
        if flow.scanning { return 300 }
        if flow.change?.isFirstImport == true, flow.error == nil { return 340 }
        return 435
    }
    #endif

    private func confirmButton(_ flow: ImportFlow) -> some View {
        Button(action: app.confirm) {
            if flow.committing { ProgressView().controlSize(.small).accessibilityLabel("Saving…") }
            else if flow.error != nil { Text("Try Again") }
            else if flow.restoringRemoved { Text("Restore \(flow.selectedRecovery.count) songs") }
            else if flow.replaces != nil { Text("Reconnect") }
            else if let change = flow.change, change.isFirstImport { Text("Import \(change.added) songs") }
            else { Text("Apply Changes") }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(flow.committing || !flow.canCommit)
    }

    private func recoverySummary(_ change: ImportChange, flow: ImportFlow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if change.recoverable.isEmpty {
                Text("None of the removed songs are currently available to restore.")
                    .foregroundStyle(TuneTheme.secondary)
            } else {
                Text("Select the songs to add back. Other songs and original files will not change.")
                    .font(.subheadline).foregroundStyle(TuneTheme.secondary)
                if change.recoverable.count < change.removedCount {
                    Text("\(change.removedCount - change.recoverable.count) removed songs are still unavailable")
                        .font(.caption).foregroundStyle(TuneTheme.secondary)
                }
                let allSelected = flow.selectedRecovery.count == change.recoverable.count
                Button(allSelected ? "Deselect All" : "Select All") { app.selectAllRecovery(!allSelected) }
                    .buttonStyle(.bordered)
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(change.recoverable) { candidate in
                        Toggle(isOn: Binding(get: { app.flow?.selectedRecovery.contains(candidate.id) == true },
                                             set: { app.selectRecovery(candidate, selected: $0) })) {
                            Text(verbatim: candidate.path.rawValue)
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
        }
        .disabled(flow.committing || flow.requiresRescan)
    }

    private func reconnectSummary(_ preview: SourceReconnectPreview) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Confirm this folder is where you moved your music.")
                .font(.headline)
            Text("Matched paths: \(preview.matched) · Unmatched paths: \(preview.unmatched)")
            ForEach(Array(preview.examples.enumerated()), id: \.offset) { _, path in
                Text(verbatim: path).font(.caption)
            }
        }
        .foregroundStyle(TuneTheme.secondary)
    }

    private func firstImportSummary(added: Int, skipped: Int) -> some View {
        let ready = Text("\(added) songs ready to import").font(.headline)
        let skippedItems = Text("\(skipped) items skipped").foregroundStyle(TuneTheme.secondary)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                ready
                if skipped > 0 {
                    Text(verbatim: "·").foregroundStyle(TuneTheme.secondary).accessibilityHidden(true)
                    skippedItems
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                ready
                if skipped > 0 { skippedItems }
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func stats(_ change: ImportChange, _ draft: ImportDraft) -> some View {
        stat("New", change.added)
        stat("Updated", change.updated)
        stat("Unchanged", change.unchanged)
        if !change.missing.isEmpty { stat("Missing", change.missing.count) }
        if !change.unplayable.isEmpty { stat("Unplayable", change.unplayable.count) }
        stat("Skipped", draft.totalSkipped - change.unplayable.count)
    }

    private func stat(_ name: LocalizedStringKey, _ count: Int, fixed: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(count, format: .number).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(TuneTheme.primary)
            Text(name).font(.caption).foregroundStyle(TuneTheme.secondary)
                .fixedSize(horizontal: fixed, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TuneTheme.canvas, in: .rect(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}

private extension SkipReason {
    var title: LocalizedStringKey {
        switch self {
        case .invalidAudio: "Damaged or unsupported audio"
        case .notDownloaded: "Not downloaded"
        case .unreadable: "Could not be read"
        case .unsupported: "Other file types"
        case .link: "Links and aliases"
        }
    }
}

extension View {
    func removalPopover<Content: View>(isPresented: Binding<Bool>, anchor: UnitPoint = .center,
                                       @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(iOS)
        phonePopover(isPresented: isPresented, anchor: anchor, content: content)
        #else
        popover(isPresented: isPresented, attachmentAnchor: .point(anchor)) {
            content().presentationCompactAdaptation(.popover)
        }
        #endif
    }
}

struct RemovalConfirmation: View {
    let title: LocalizedStringKey
    let name: String
    let cancel: () -> Void
    let confirm: () -> Void
    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .headline) private var phoneTitleSize: CGFloat = 16
    @ScaledMetric(relativeTo: .subheadline) private var phoneBodySize: CGFloat = 14
    #else
    @FocusState private var cancelFocused: Bool
    #endif

    var body: some View {
        #if os(iOS)
        PhonePopoverSurface { content.frame(width: textSize.isAccessibilitySize ? 288 : 240) }
        #else
        ViewThatFits(in: .vertical) {
            content.fixedSize(horizontal: false, vertical: true)
            ScrollView { content }
        }
        .frame(width: 280)
        .defaultFocus($cancelFocused, true)
        .onAppear { cancelFocused = true }
        .background(TuneTheme.raised)
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Label(title, systemImage: "trash")
                    #if os(iOS)
                    .font(.system(size: phoneTitleSize, weight: .semibold))
                    #else
                    .font(.headline)
                    #endif
                    .foregroundStyle(TuneTheme.primary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: name)
                    .foregroundStyle(TuneTheme.secondary)
                    #if os(iOS)
                    .font(.system(size: phoneBodySize))
                    .lineLimit(textSize.isAccessibilitySize ? nil : 2)
                    #else
                    .font(.subheadline)
                    .lineLimit(2)
                    .help(name)
                    #endif
            }
            .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { buttons }
                VStack(alignment: .trailing, spacing: 6) { buttons }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16)
    }

    @ViewBuilder private var buttons: some View {
        #if os(iOS)
        phoneButton("Cancel", role: .cancel, action: cancel)
            .keyboardShortcut(.cancelAction)
        phoneButton("Confirm", action: confirm)
            .tint(TuneTheme.accent)
            .foregroundStyle(TuneTheme.accent)
        #else
        Button("Cancel", role: .cancel, action: cancel)
            .buttonStyle(.bordered)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .focusable()
            .focused($cancelFocused)
        Button("Confirm", action: confirm)
            .buttonStyle(.bordered)
            .controlSize(.large)
            .tint(TuneTheme.accent)
            .foregroundStyle(TuneTheme.accent)
        #endif
    }

    #if os(iOS)
    private func phoneButton(_ title: LocalizedStringKey, role: ButtonRole? = nil,
                             action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Text(title)
                .font(.system(size: phoneBodySize, weight: .medium))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .controlSize(.regular)
    }
    #endif
}

struct SourcesView: View {
    let app: AppState
    @State private var pendingRemoval: UUID?

    var body: some View {
        #if os(iOS)
        phoneBody
        #else
        desktopBody
        #endif
    }

    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var phoneActionsSource: UUID?

    @ViewBuilder private var phoneBody: some View {
        if app.snapshot.sources.isEmpty {
            EmptyLibrary(app: app, showSources: {})
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(app.snapshot.sources) { source in
                        sourceCard(source)
                        if source.id != app.snapshot.sources.last?.id {
                            Divider().padding(.horizontal, 16)
                        }
                    }
                }
                .tuneCard(cornerRadius: 22)
                .frame(maxWidth: 720)
                .padding(.horizontal, 16)
                .padding(.top, textSize.isAccessibilitySize ? 8 : 54)
                .padding(.bottom, 18)
                .frame(maxWidth: .infinity)
            }
        }
    }

    #else
    private var desktopBody: some View {
        Group {
            if app.snapshot.sources.isEmpty {
                ContentUnavailableView {
                    Label("No music sources", systemImage: "folder")
                } actions: { Button("Add Folder") { app.choose() }.disabled(!app.canImport) }
            } else {
                CatalogScroll {
                    ForEach(app.snapshot.sources) { source in sourceCard(source) }
                }
            }
        }
    }
    #endif

    @ViewBuilder private func sourceCard(_ source: MusicSource) -> some View {
        let unavailable = app.unavailable.contains(source.id)
        #if os(iOS)
        phoneSourceCard(source, unavailable: unavailable)
        #else
        desktopSourceCard(source, unavailable: unavailable)
        #endif
    }

    #if os(iOS)
    private func phoneSourceCard(_ source: MusicSource, unavailable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(verbatim: source.name)
                        .font(.headline)
                        .foregroundStyle(TuneTheme.primary)
                        .lineLimit(textSize.isAccessibilitySize ? nil : 2)
                    sourceMetadata(source, showFolderLabel: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
                Button { phoneActionsSource = source.id } label: {
                    Image(systemName: "ellipsis")
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(TuneTheme.accent)
                .accessibilityLabel("Source Actions")
                .disabled(!app.canImport)
                .phonePopover(isPresented: Binding(get: { phoneActionsSource == source.id }, set: { presented in
                    if presented { phoneActionsSource = source.id }
                    else if phoneActionsSource == source.id { phoneActionsSource = nil }
                })) {
                    PhoneSourceActionsPopover(
                        canImport: app.canImport,
                        showsRescan: !unavailable,
                        showsRestore: !unavailable && app.snapshot.excludedCount(for: source.id) > 0,
                        close: { phoneActionsSource = nil },
                        onSelect: { performPhoneSourceAction($0, source: source) }
                    )
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .contextMenu { sourceMenu(source, unavailable: unavailable) }
    }

    #else
    private func desktopSourceCard(_ source: MusicSource, unavailable: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "folder")
                .foregroundStyle(TuneTheme.accent)
                .frame(width: 34, height: 34)
                .background(TuneTheme.subtle, in: .rect(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(source.name).font(.headline).foregroundStyle(TuneTheme.primary).lineLimit(2)
                sourceMetadata(source)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if unavailable { sourceWarning }
            sourceActions(source, unavailable: unavailable)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .tuneCard()
        .contentShape(.rect(cornerRadius: 16))
        .contextMenu { sourceMenu(source, unavailable: unavailable) }
        .removalPopover(isPresented: Binding(get: { pendingRemoval == source.id }, set: { if !$0, pendingRemoval == source.id { pendingRemoval = nil } }),
                        anchor: .trailing) {
            RemovalConfirmation(title: "Remove Source?", name: source.name) {
                pendingRemoval = nil
            } confirm: {
                pendingRemoval = nil
                app.remove(source)
            }
        }
    }
    #endif

    @ViewBuilder private func sourceMenu(_ source: MusicSource, unavailable: Bool) -> some View {
        if !unavailable {
            Button("Rescan Folder", systemImage: "arrow.clockwise") { app.rescan(source) }
                .disabled(!app.canImport)
            if app.snapshot.excludedCount(for: source.id) > 0 {
                Button("Restore Removed Songs", systemImage: "arrow.uturn.backward") { app.restoreRemoved(in: source) }
                    .disabled(!app.canImport)
            }
        }
        Button("Choose Folder Again", systemImage: "folder") { app.choose(source) }
            .disabled(!app.canImport)
        Divider()
        #if os(iOS)
        Button("Remove Source", systemImage: "trash", role: .destructive) { app.remove(source) }
            .disabled(!app.canImport)
        #else
        Button("Remove Source", systemImage: "trash", role: .destructive) { pendingRemoval = source.id }
            .disabled(!app.canImport)
        #endif
    }

    #if os(iOS)
    private func performPhoneSourceAction(_ action: PhoneSourceActionsPopover.Action, source: MusicSource) {
        guard app.canImport, app.snapshot.sources.contains(where: { $0.id == source.id }) else { return }
        switch action {
        case .rescan: app.rescan(source)
        case .reauthorize: app.choose(source)
        case .restore: app.restoreRemoved(in: source)
        case .remove: app.remove(source)
        }
    }
    #endif

    private func sourceMetadata(_ source: MusicSource, showFolderLabel: Bool = false) -> some View {
        let contents = app.snapshot.contents(for: source.id)
        let songs = Text("\(contents.tracks.count) songs")
        let detail = showFolderLabel ? Text("Local folder") : Text(source.lastScan, format: .dateTime.month(.abbreviated).day().hour().minute())
        let missing = contents.missingTracks
        let unplayable = contents.unplayableTracks
        return VStack(alignment: .leading, spacing: 4) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    songs
                    Text(verbatim: "·").accessibilityHidden(true)
                    detail
                }
                VStack(alignment: .leading, spacing: 2) {
                    songs
                    detail
                }
            }
            let removed = app.snapshot.excludedCount(for: source.id)
            if removed > 0 { Text("\(removed) removed songs") }
            if !missing.isEmpty { unavailablePaths(missing, label: "\(missing.count) missing songs") }
            if !unplayable.isEmpty { unavailablePaths(unplayable, label: "\(unplayable.count) unplayable songs") }
        }
        .font(.caption)
        .foregroundStyle(TuneTheme.secondary)
    }

    private func unavailablePaths(_ tracks: [Track], label: LocalizedStringKey) -> some View {
        DisclosureGroup {
            ForEach(tracks.prefix(5)) { track in
                Text(verbatim: track.path.rawValue)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } label: { Text(label) }
    }

    private var sourceWarning: some View {
        let label = Label("Source unavailable", systemImage: "exclamationmark.circle")
        return ViewThatFits(in: .horizontal) {
            label.labelStyle(.titleAndIcon)
            label.labelStyle(.iconOnly)
        }
        .font(.caption)
        .foregroundStyle(TuneTheme.problem)
    }

    private func sourceActions(_ source: MusicSource, unavailable: Bool) -> some View {
        HStack(spacing: 0) {
            if unavailable {
                SourceCardAction("Choose Folder Again") {
                    Button { app.choose(source) } label: { icon("arrow.triangle.2.circlepath", inset: .leading) }
                        .buttonStyle(.plain)
                }
            } else {
                SourceCardAction("Rescan Folder") {
                    Button { app.rescan(source) } label: { icon("arrow.clockwise", inset: .leading) }
                        .buttonStyle(.plain)
                }
            }
            SourceCardAction("Source Actions") {
                Menu {
                    sourceMenu(source, unavailable: unavailable)
                } label: { icon("ellipsis", inset: .trailing) }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .disabled(!app.canImport)
    }

    private func icon(_ symbol: String, inset edge: Edge.Set) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(TuneTheme.accent)
            .padding(edge, 8)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }
}

#if os(iOS)
private struct PhoneSourceActionsPopover: View {
    enum Action {
        case rescan, restore, reauthorize, remove

        var title: LocalizedStringKey {
            switch self {
            case .rescan: "Rescan Folder"
            case .restore: "Restore Removed Songs"
            case .reauthorize: "Choose Folder Again"
            case .remove: "Remove Source"
            }
        }

        var symbol: String {
            switch self {
            case .rescan: "arrow.clockwise"
            case .restore: "arrow.uturn.backward"
            case .reauthorize: "folder"
            case .remove: "trash"
            }
        }
    }

    let canImport: Bool
    let showsRescan: Bool
    let showsRestore: Bool
    let close: () -> Void
    let onSelect: (Action) -> Void

    @State private var selectedAction: Action?

    var body: some View {
        PhoneActionPopover {
            if showsRescan { GridRow { row(.rescan) } }
            if showsRestore { GridRow { row(.restore) } }
            GridRow { row(.reauthorize) }
            PhonePopoverDivider()
            GridRow { row(.remove) }
        }
        .onDisappear {
            guard let selectedAction else { return }
            self.selectedAction = nil
            // Run the removal or picker action after the anchored menu is gone.
            Task { @MainActor in onSelect(selectedAction) }
        }
    }

    private func row(_ action: Action) -> some View {
        PhonePopoverAction(action.title, symbol: action.symbol, role: action == .remove ? .destructive : nil) {
            guard selectedAction == nil else { return }
            selectedAction = action
            close()
        }
        .disabled(!canImport || selectedAction != nil)
    }
}
#endif

/// The tooltip is only visual: the native control still owns focus, input and its accessible name.
private struct SourceCardAction<Control: View>: View {
    let title: LocalizedStringKey
    let control: Control
    @Environment(\.isEnabled) private var isEnabled
    #if os(macOS)
    @State private var isHovering = false
    @State private var showHint = false
    #endif

    init(_ title: LocalizedStringKey, @ViewBuilder control: () -> Control) {
        self.title = title
        self.control = control()
    }

    var body: some View {
        control
            .accessibilityLabel(Text(title))
            .opacity(isEnabled ? (isHighlighted ? 0.75 : 1) : 0.45)
            #if os(macOS)
            .onHover { hovering in
                isHovering = hovering
                if !hovering { showHint = false }
            }
            .task(id: isHighlighted) {
                showHint = false
                guard isHighlighted else { return }
                try? await Task.sleep(for: .milliseconds(350))
                if !Task.isCancelled { showHint = true }
            }
            .overlay(alignment: .bottomTrailing) {
                if showHint && isHighlighted {
                    hint.alignmentGuide(.bottom) { $0[.top] + 4 }
                }
            }
            .zIndex(showHint && isHighlighted ? 1 : 0)
            #endif
    }

    private var isHighlighted: Bool {
        #if os(macOS)
        isEnabled && isHovering
        #else
        false
        #endif
    }

    #if os(macOS)
    private var hint: some View {
        Text(title)
            .font(.caption.weight(.medium))
            .foregroundStyle(TuneTheme.primary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(TuneTheme.raised, in: .rect(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(TuneTheme.primary.opacity(0.16)) }
            .shadow(color: .black.opacity(0.18), radius: 6, y: 3)
            .fixedSize()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
    #endif
}

#if os(iOS)
private struct PhoneSheetPrimaryButton: ButtonStyle {
    let labelSize: CGFloat
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: labelSize, weight: .semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(TuneTheme.onAccent)
            .tint(TuneTheme.onAccent)
            .background(TuneTheme.accent.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45),
                        in: .rect(cornerRadius: 14))
    }
}

#endif

struct TuneSettings: View {
    var body: some View {
        Form {
            Section("About Tinytune") {
                Label("Local Music Player", systemImage: "music.note")
                Text("No account or uploads.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        #if os(macOS)
        .navigationTitle(String(localized: "Settings", bundle: AppLanguage.bundle, locale: AppLanguage.locale))
        .frame(width: 440, height: 200)
        #endif
    }
}
