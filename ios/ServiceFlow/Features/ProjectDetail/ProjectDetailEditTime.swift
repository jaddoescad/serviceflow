import ServiceFlowCore
import SwiftUI

/// Edit one of your own clock-ins from Project Detail.
struct ProjectDetailEditTime: View {
    let entry: TimeEntry
    let painterName: String
    let onClose: () -> Void
    /// Called after a successful save or delete.
    let onChanged: (_ deleted: Bool) -> Void

    @Environment(TimeTracker.self) private var tracker
    @State private var startAt: Date
    @State private var endAt: Date
    @State private var busy = false
    @State private var error: String?
    @State private var showDistance = false
    @State private var confirmDelete = false

    init(entry: TimeEntry, painterName: String, onClose: @escaping () -> Void, onChanged: @escaping (_ deleted: Bool) -> Void) {
        self.entry = entry
        self.painterName = painterName
        self.onClose = onClose
        self.onChanged = onChanged
        _startAt = State(initialValue: entry.startedAt)
        _endAt = State(initialValue: entry.endedAt ?? entry.startedAt)
    }

    private var isActive: Bool { entry.isActive }
    private var startChanged: Bool { Int(startAt.timeIntervalSince(entry.startedAt)) != 0 }
    private var endChanged: Bool { !isActive && Int(endAt.timeIntervalSince(entry.endedAt ?? entry.startedAt)) != 0 }

    private var canSave: Bool {
        guard !busy else { return false }
        if isActive { return startChanged }
        return (startChanged || endChanged) && endAt > startAt
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button(action: onClose) {
                    Image(systemName: "chevron.left").font(.system(size: 26, weight: .semibold)).foregroundStyle(.black)
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 10)
                .accessibilityLabel("Back")
                Text("Edit Time").text(38, .heavy, Color(hex: 0x202124), tracking: -1.2)
                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .frame(height: 116, alignment: .top)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xe8e8e8)).frame(height: 1) }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    shiftCard
                    HStack(spacing: 11) {
                        ForEach(0..<6, id: \.self) { index in
                            Circle().fill(Color(hex: index == 5 ? 0x949494 : 0xe0e0e0)).frame(width: 9, height: 9)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 28)
                    .padding(.bottom, 16)
                    formCard
                    Text("Tap the map preview to show distance from the job site. \(entry.project.fullAddress ?? "")")
                        .text(11, .semibold, DetailPalette.muted)
                        .lineLimit(2)
                        .padding(.top, 14)
                }
                .padding(EdgeInsets(top: 18, leading: 24, bottom: 18, trailing: 14))
            }
            .scrollBounceBehavior(.basedOnSize)

            bottomBar
        }
        .background(Color(hex: 0xf6f6f6).ignoresSafeArea())
        .alert("Delete time entry?", isPresented: $confirmDelete) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { delete() }
        } message: {
            Text("This can't be undone.")
        }
    }

    // MARK: Parts

    private var shiftCard: some View {
        let summary = SegmentSummary(entry, now: Date())
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(painterName).text(18, .heavy, DetailPalette.text)
                    HStack(spacing: 6) {
                        Image(systemName: "mappin").font(.system(size: 17, weight: .semibold)).foregroundStyle(Color(hex: 0x4e659f))
                        Text(entry.project.name).text(16, .heavy, Color(hex: 0x4e659f)).lineLimit(1)
                    }
                    .padding(.top, 12)
                }
                Spacer(minLength: 8)
                mapPreview(summary)
            }
            VStack(alignment: .leading, spacing: 6) {
                timelineStop(DateText.time(startAt), source: entry.startedLocation == nil ? "Manual" : "GPS", color: Color(hex: 0x6ba7ff))
                Rectangle().fill(Color(hex: 0xc8ccd0)).frame(width: 1, height: 18).padding(.leading, 4)
                timelineStop(isActive ? "In progress" : DateText.time(endAt),
                             source: isActive ? nil : (entry.lastLocation == nil ? "Manual" : "GPS"), color: Color(hex: 0x7087bd))
            }
            .padding(.top, 28)
        }
        .padding(EdgeInsets(top: 18, leading: 18, bottom: 14, trailing: 18))
        .bordered(12, border: Color(hex: 0x8f9296), width: 1.2)
    }

    private func timelineStop(_ time: String, source: String?, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(time).text(18, .heavy, color)
            if let source { Text(source).font(.app(12, .heavy).italic()).foregroundStyle(Color(hex: 0x6482bd)) }
        }
    }

    private func mapPreview(_ summary: SegmentSummary) -> some View {
        Button {
            showDistance.toggle()
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xe8f2ef))
                ForEach(0..<3, id: \.self) { index in
                    Capsule().fill(.white).frame(width: 110, height: 7)
                        .rotationEffect(.degrees([-28, 18, 62][index]))
                        .offset(y: CGFloat([-18, 8, 20][index]))
                }
                Circle().fill(DetailPalette.brand.opacity(0.18)).frame(width: 46, height: 46)
                Image(systemName: "mappin")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 27, height: 27)
                    .background(Color(hex: 0x91cbb1), in: Circle())
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                Image(systemName: "clock.fill")
                    .font(.system(size: 12)).foregroundStyle(DetailPalette.brand)
                    .frame(width: 29, height: 29)
                    .background(.white, in: Circle())
                    .overlay(Circle().strokeBorder(Color(hex: 0x8fc7d5), lineWidth: 1))
                    .offset(x: 24, y: -20)
                if showDistance {
                    VStack {
                        Spacer()
                        Text(summary.latestDistance.map { "\(DistanceFormat.meters($0)) from site" } ?? "distance unknown")
                            .text(9.5, .heavy, .white)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .frame(maxWidth: .infinity)
                            .background(Color(rgba: 49, 73, 93, 0.92))
                    }
                }
            }
            .frame(width: 86, height: 76)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(hex: 0xd9e4df), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show distance from the job site")
    }

    private var formCard: some View {
        VStack(spacing: 0) {
            formRow("Date", DateText.format(startAt, template: "MMMdy"))
            formRow("Clock-In Time", DateText.time(startAt))
            if let note = TimesheetBuilder.originalTimeNote(entry: entry, startAt: startAt, endAt: isActive ? nil : endAt) {
                Text(note).text(12, .bold, DetailPalette.muted).frame(maxWidth: .infinity, alignment: .trailing).padding(.bottom, 6)
            }
            adjustButtons(label: "clock-in time", disabled: false) { startAt = startAt.addingTimeInterval($0) }
            formRow("Clock-Out Time", isActive ? "In progress" : DateText.time(endAt))
            adjustButtons(label: "clock-out time", disabled: isActive) { endAt = endAt.addingTimeInterval($0) }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                formRow("Duration", DurationFormat.hoursMinutes(max(0, (isActive ? context.date : endAt).timeIntervalSince(startAt))))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
        .bordered(6, border: DetailPalette.border)
    }

    private func formRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).text(20, .medium, .black)
            Spacer(minLength: 8)
            Text(value)
                .text(20, .medium, .black)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 14)
                .frame(minHeight: 41)
                .background(Color(hex: 0xeeeeef), in: RoundedRectangle(cornerRadius: 24))
        }
        .frame(minHeight: 48)
    }

    private func adjustButtons(label: String, disabled: Bool, step: @escaping (TimeInterval) -> Void) -> some View {
        HStack(spacing: 8) {
            Spacer()
            adjustButton("-5m", accessibility: "Subtract 5 minutes from \(label)") { step(-300) }
            adjustButton("+5m", accessibility: "Add 5 minutes to \(label)") { step(300) }
        }
        .disabled(disabled || busy)
        .opacity(disabled ? 0.4 : 1)
        .padding(.bottom, 8)
    }

    private func adjustButton(_ title: String, accessibility: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .text(12, .heavy, DetailPalette.brand)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .overlay(Capsule().strokeBorder(DetailPalette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
    }

    private var bottomBar: some View {
        VStack(spacing: 0) {
            if let error {
                Text(error).text(13, .bold, Palette.red).multilineTextAlignment(.center).padding(.bottom, 8)
            }
            if isActive {
                Text("This shift is still in progress. Only the start time can be changed.")
                    .text(12.5, .semibold, DetailPalette.muted).multilineTextAlignment(.center).padding(.bottom, 10)
            }
            Button(action: save) {
                ZStack {
                    if busy { ProgressView().tint(.white) } else { Text("Save Changes").text(20, .heavy, .white) }
                }
                .frame(maxWidth: .infinity, minHeight: 54)
                .background(canSave || busy ? DetailPalette.brand : Color(hex: 0xd7dcde), in: RoundedRectangle(cornerRadius: 4))
            }
            .buttonStyle(.plain)
            .disabled(!canSave)
            HStack(spacing: 18) {
                Button(action: onClose) {
                    Text("Cancel").text(20, .heavy, Color(hex: 0x8d8d8d))
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(hex: 0x8d8d8d), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Button { confirmDelete = true } label: {
                    Text("Delete").text(20, .heavy, Color(hex: 0xef716d))
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(hex: 0xf36b65), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
            .padding(.top, 12)
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 16)
        .background(Color(hex: 0xf6f6f6))
    }

    // MARK: Actions

    private func save() {
        guard canSave else { return }
        busy = true
        error = nil
        Task {
            do {
                try await tracker.updateEntry(entry, startedAt: startAt, endedAt: isActive ? nil : endAt)
                busy = false
                onChanged(false)
                onClose()
            } catch {
                busy = false
                self.error = error.localizedDescription.isEmpty ? "Could not save changes. Try again." : error.localizedDescription
            }
        }
    }

    private func delete() {
        busy = true
        error = nil
        Task {
            await tracker.deleteEntry(entry)
            busy = false
            onChanged(true)
            onClose()
        }
    }
}
