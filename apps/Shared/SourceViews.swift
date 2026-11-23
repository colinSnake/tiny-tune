import DesignSystem
import Library
import SwiftUI

struct ImportSheet: View {
    let app: AppState
    var body: some View {
        if let flow = app.flow {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "folder.badge.plus")
                        .font(.title2).foregroundStyle(TuneTheme.accent)
                        .frame(width: 44, height: 44)
                        .background(TuneTheme.subtle, in: .rect(cornerRadius: 10))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(flow.replaces == nil ? "Import Music" : "Reconnect Source")
                            .font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Text(flow.name).font(.subheadline).foregroundStyle(TuneTheme.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
                .padding(20)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if flow.scanning {
                            ProgressView("Checking music files…")
                            Text("\(flow.progress.checked) checked · \(flow.progress.accepted) playable")
                                .foregroundStyle(TuneTheme.secondary)
                        }
                        if let draft = flow.draft, let change = flow.change {
                            if change.isFirstImport {
                                firstImportSummary(added: change.added, skipped: draft.totalSkipped)
                            } else {
                                ViewThatFits(in: .horizontal) {
                                    HStack(alignment: .top, spacing: 8) { stats(change, draft) }
                                    VStack(alignment: .leading, spacing: 8) { stats(change, draft) }
                                }
                            }
                            if let reconnect = change.reconnect { reconnectSummary(reconnect) }
                            if !flow.canCommit {
                                (draft.audio.isEmpty ? Text("No playable music was found in this folder.") : Text("No changes to apply."))
                                    .foregroundStyle(TuneTheme.secondary)
                            }
                            if draft.totalSkipped > 0 {
                                Text("Skipped items").font(.headline).accessibilityAddTraits(.isHeader)
                                ForEach(SkipReason.allCases, id: \.self) { reason in
                                    if let info = draft.skipped[reason] {
                                        DisclosureGroup {
                                            ForEach(Array(info.examples.enumerated()), id: \.offset) { _, name in
                                                Text(name).font(.caption).foregroundStyle(TuneTheme.secondary)
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                            }
                                        } label: {
                                            HStack { Text(reason.title); Spacer(); Text(info.count, format: .number).monospacedDigit() }
                                        }
                                    }
                                }
                            }
                        }
                        if let error = flow.error {
                            Label { Text(error) } icon: { Image(systemName: "exclamationmark.circle") }
                                .foregroundStyle(TuneTheme.problem)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .frame(minHeight: flow.scanning ? 130 : 160)
                Divider()
                HStack {
                    Spacer()
                    Button { app.cancelFlow() } label: {
                        if flow.scanning || flow.canCommit { Text("Cancel") } else { Text("Done") }
                    }
                        .keyboardShortcut(.cancelAction)
                        .disabled(flow.committing)
                    if flow.canCommit {
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
            #if os(macOS)
            .frame(width: 540, height: macHeight(flow))
            #else
            .presentationDetents([.large])
            .interactiveDismissDisabled(flow.committing)
            #endif
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
            else if flow.replaces != nil { Text("Reconnect") }
            else if let change = flow.change, change.isFirstImport { Text("Import \(change.added) songs") }
            else { Text((flow.change?.updated ?? 0) > 0 ? "Apply Changes" : "Add to Library") }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(flow.committing)
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
        stat("Skipped", draft.totalSkipped)
    }

    private func stat(_ name: LocalizedStringKey, _ count: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(count, format: .number).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(TuneTheme.primary)
            Text(name).font(.caption).foregroundStyle(TuneTheme.secondary)
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
        popover(isPresented: isPresented, attachmentAnchor: .point(anchor)) {
            content().presentationCompactAdaptation(.popover)
        }
    }
}

struct RemovalConfirmation: View {
    let title: LocalizedStringKey
    let name: String
    let cancel: () -> Void
    let confirm: () -> Void
    #if os(macOS)
    @FocusState private var cancelFocused: Bool
    #endif

    var body: some View {
        ViewThatFits(in: .vertical) {
            content.fixedSize(horizontal: false, vertical: true)
            ScrollView { content }
        }
        #if os(macOS)
        .frame(width: 280)
        .defaultFocus($cancelFocused, true)
        .onAppear { cancelFocused = true }
        #else
        .frame(width: 288)
        #endif
        .background(TuneTheme.raised)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Label(title, systemImage: "trash")
                    .font(.headline)
                    .foregroundStyle(TuneTheme.primary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: name)
                    .font(.subheadline)
                    .foregroundStyle(TuneTheme.secondary)
                    .lineLimit(2)
                    #if os(macOS)
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
        Button("Cancel", role: .cancel, action: cancel)
            .buttonStyle(.bordered)
            .controlSize(.large)
            #if os(macOS)
            .keyboardShortcut(.defaultAction)
            .focusable()
            .focused($cancelFocused)
            #else
            .keyboardShortcut(.cancelAction)
            #endif
        Button("Confirm", action: confirm)
            .buttonStyle(.bordered)
            .controlSize(.large)
            .tint(TuneTheme.accent)
            .foregroundStyle(TuneTheme.accent)
    }
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
    private var phoneBody: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if app.snapshot.sources.isEmpty {
                    phoneEmptyState
                } else {
                    phoneSummary
                    ForEach(app.snapshot.sources) { source in sourceCard(source) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity)
        }
    }

    private var phoneEmptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(TuneTheme.accent)
                .frame(width: 64, height: 64)
                .background(TuneTheme.subtle, in: .rect(cornerRadius: 18))
                .accessibilityHidden(true)
            VStack(spacing: 7) {
                Text("No music sources")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(TuneTheme.primary)
                    .accessibilityAddTraits(.isHeader)
                Text("Add a folder of music. Your files stay where they are.")
                    .font(.subheadline)
                    .foregroundStyle(TuneTheme.secondary)
                    .multilineTextAlignment(.center)
            }
            Button { app.choose() } label: {
                Label("Add Folder", systemImage: "plus")
            }
            .buttonStyle(TunePrimaryButton())
            .disabled(!app.canImport)
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.vertical, 56)
    }

    private var phoneSummary: some View {
        HStack(spacing: 12) {
            Image(systemName: "folder.fill")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(TuneTheme.accent)
                .frame(width: 42, height: 42)
                .background(TuneTheme.subtle, in: .rect(cornerRadius: 12))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("Music Sources")
                    .font(.headline)
                    .foregroundStyle(TuneTheme.primary)
                Text("\(app.snapshot.sources.count) music folders")
                    .font(.subheadline)
                    .foregroundStyle(TuneTheme.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .tuneCard()
        .accessibilityElement(children: .combine)
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

    private func count(_ source: MusicSource) -> Int { app.snapshot.tracks.lazy.filter { $0.rootID == source.id }.count }

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
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: unavailable ? "folder.badge.exclamationmark" : "folder")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(unavailable ? TuneTheme.problem : TuneTheme.accent)
                    .frame(width: 42, height: 42)
                    .background((unavailable ? TuneTheme.problem : TuneTheme.accent).opacity(0.11), in: .rect(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(source.name)
                        .font(.headline)
                        .foregroundStyle(TuneTheme.primary)
                        .lineLimit(2)
                    sourceMetadata(source)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if unavailable { sourceWarning }
            }
            Divider()
            sourceActions(source, unavailable: unavailable)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(14)
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
        }
        Button("Choose Folder Again", systemImage: "folder") { app.choose(source) }
            .disabled(!app.canImport)
        Divider()
        Button("Remove Source", systemImage: "trash", role: .destructive) { pendingRemoval = source.id }
            .disabled(!app.canImport)
    }

    private func sourceMetadata(_ source: MusicSource) -> some View {
        let songs = Text("\(count(source)) songs")
        let scan = Text(source.lastScan, format: .dateTime.month(.abbreviated).day().hour().minute())
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                songs
                Text(verbatim: "·").accessibilityHidden(true)
                scan
            }
            VStack(alignment: .leading, spacing: 2) {
                songs
                scan
            }
        }
        .font(.caption)
        .foregroundStyle(TuneTheme.secondary)
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

struct AboutTinytuneView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "music.note.list")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(TuneTheme.accent)
                .frame(width: 56, height: 56)
                .background(TuneTheme.subtle, in: .rect(cornerRadius: 16))
                .accessibilityHidden(true)
            Text("Local Music Player")
                .font(.headline)
                .foregroundStyle(TuneTheme.primary)
            Text("No account or uploads.")
                .font(.subheadline)
                .foregroundStyle(TuneTheme.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
        .background(TuneTheme.canvas)
    }
}

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
