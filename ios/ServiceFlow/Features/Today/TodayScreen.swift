import MapKit
import ServiceFlowCore
import SwiftUI

/// Owners' and managers' Today tab, as on the website: the jobs someone
/// clocked in to today, on a map and as cards with the crew and the budget.
struct TodayScreen: View {
    let enabled: Bool

    @Environment(SessionContext.self) private var session
    @State private var jobs: [TodayJob]?
    @State private var startOfDay = Calendar.current.startOfDay(for: Date())
    @State private var error: String?

    init(enabled: Bool) {
        self.enabled = enabled
    }

    var body: some View {
        List {
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.app(13, .semibold))
                        .foregroundStyle(Color(hex: 0xb42318))
                }
            }
            if let jobs {
                Section {
                    if jobs.isEmpty {
                        ContentUnavailableView("No one has clocked in yet today", systemImage: "sun.max")
                            .listRowBackground(Color.clear)
                    } else {
                        TodayMap(jobs: jobs) { session.open($0.project) }
                            .frame(height: 220)
                            .listRowInsets(EdgeInsets())
                    }
                } header: {
                    Text(header(jobs))
                }
                ForEach(jobs) { job in
                    Section {
                        NavigationLink(value: ProjectRoute(project: job.project)) {
                            TodayJobCard(job: job, startOfDay: startOfDay)
                        }
                    }
                }
            } else if error == nil {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading today…").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(12)
        .navigationTitle("Today")
        .refreshable { await load() }
        .task(id: enabled) {
            // Showing the tab refreshes, then every minute while it's visible.
            guard enabled else { return }
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    private func header(_ jobs: [TodayJob]) -> String {
        let date = DateText.format(Date(), template: "EEEEMMMMd", locale: DateText.canada)
        return jobs.isEmpty ? date : "\(date) · \(TodayBoard.summary(jobs))"
    }

    private func load() async {
        let day = Calendar.current.startOfDay(for: Date())
        do {
            jobs = try await session.api.todayJobs(startOfDay: day)
            startOfDay = day
            error = nil
        } catch is CancellationError {
        } catch {
            // Keep what is already on screen.
            self.error = error.localizedDescription
        }
    }
}

/// Today's jobs as pins labelled with the crew count and the job name.
private struct TodayMap: View {
    var jobs: [TodayJob]
    var onSelect: (TodayJob) -> Void

    var body: some View {
        Map(initialPosition: region) {
            ForEach(jobs.filter { $0.coordinate != nil }) { job in
                Annotation(job.project.name, coordinate: job.coordinate!.location, anchor: .center) {
                    Button { onSelect(job) } label: {
                        HStack(spacing: 6) {
                            Text("\(job.painters.filter { $0.inTodayAt != nil }.count)")
                                .text(11, .bold, .white)
                                .frame(width: 20, height: 20)
                                .background(Palette.teal, in: Circle())
                            Text(job.project.name).text(12, .semibold, Palette.ink).lineLimit(1)
                        }
                        .padding(.leading, 3)
                        .padding(.trailing, 9)
                        .padding(.vertical, 3)
                        .background(.white, in: Capsule())
                        .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
                    }
                    .buttonStyle(.plain)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
    }

    /// Every pin with room around it for its label.
    private var region: MapCameraPosition {
        let points = jobs.compactMap(\.coordinate)
        guard let first = points.first else { return .automatic }
        var (minLat, maxLat, minLng, maxLng) = (first.latitude, first.latitude, first.longitude, first.longitude)
        for point in points {
            minLat = min(minLat, point.latitude); maxLat = max(maxLat, point.latitude)
            minLng = min(minLng, point.longitude); maxLng = max(maxLng, point.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max(0.02, (maxLat - minLat) * 1.8),
                                    longitudeDelta: max(0.04, (maxLng - minLng) * 2.6))
        return .region(MKCoordinateRegion(center: center, span: span))
    }
}

/// One job: name, address, labour budget, and its crew with today's clock-ins.
private struct TodayJobCard: View {
    var job: TodayJob
    var startOfDay: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(job.project.name).font(.app(16, .semibold)).lineLimit(1)
                if let address = job.project.cardAddress {
                    Text(address).font(.app(13)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            budget
            Divider()
            VStack(spacing: 8) {
                ForEach(job.painters) { painter in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(painter.isOnClock ? Palette.teal : Color(hex: 0xc9cfcd))
                            .frame(width: 8, height: 8)
                        Text(painter.name)
                            .font(.app(14, painter.inTodayAt != nil ? .semibold : .regular))
                            .foregroundStyle(painter.inTodayAt != nil ? .primary : .secondary)
                            .lineLimit(1)
                        if let time = TodayBoard.timeLabel(painter, startOfDay: startOfDay) {
                            Text(time).font(.app(12)).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Text(DurationFormat.hoursMinutes(minutes: painter.totalMinutes))
                            .font(.app(13)).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var budget: some View {
        if let line = TodayBoard.budgetLine(job.project.budget) {
            let color = Color(hex: BudgetPresentation(job.project.budget).colorHex)
            VStack(spacing: 5) {
                HStack {
                    Text(line.label).font(.app(12)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(line.percent)%")
                        .font(.app(12, line.percent > 100 ? .bold : .regular))
                        .foregroundStyle(line.percent > 100 ? color : .primary)
                        .monospacedDigit()
                }
                GeometryReader { proxy in
                    Capsule().fill(Color(hex: 0xe5e9e8))
                        .overlay(alignment: .leading) {
                            Capsule().fill(color).frame(width: proxy.size.width * min(1, Double(line.percent) / 100))
                        }
                }
                .frame(height: 4)
            }
        } else {
            Text("No labour budget").font(.app(12)).foregroundStyle(.tertiary)
        }
    }
}
