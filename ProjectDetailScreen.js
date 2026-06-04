import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const COLORS = {
  green: "#173f37",
  teal: "#2f8d7f",
  brown: "#7c5127",
  white: "#ffffff",
  surface: "#f7f8f7",
  border: "#e0e3e1",
  muted: "#8b9692",
  ink: "#11201d",
};

const TABS = [
  { key: "clockins", label: "Clock Ins", icon: "clock" },
  { key: "details", label: "Details", icon: "pin" },
  { key: "photos", label: "Photos", icon: "photo" },
  { key: "notes", label: "Notes", icon: "note" },
  { key: "list", label: "", icon: "list" },
];

export default function ProjectDetailScreen({ project, onBack }) {
  const [activeTab, setActiveTab] = useState("clockins");

  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft color={COLORS.ink} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.projectName} numberOfLines={1}>
            {project?.name || "Project"}
          </Text>
          <Text style={styles.projectSub}>Added {formatAddedDate(project)}</Text>
        </View>
        <View style={styles.headerActions}>
          <HeaderIconBtn>
            <NotifIcon color={COLORS.ink} />
          </HeaderIconBtn>
          <HeaderIconBtn>
            <PencilIcon color={COLORS.ink} />
          </HeaderIconBtn>
          <HeaderIconBtn>
            <ShareIcon color={COLORS.ink} />
          </HeaderIconBtn>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key;
          const isListTab = t.icon === "list";
          return (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[
                styles.tabPill,
                active && styles.tabPillActive,
                isListTab && styles.tabPillSquare,
              ]}
            >
              <TabIcon name={t.icon} color={active ? COLORS.white : COLORS.ink} />
              {t.label ? (
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {t.label}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <MapCard />

        <Pressable style={({ pressed }) => [styles.clockInBtn, pressed && { opacity: 0.7 }]}>
          <PlayCircle color={COLORS.teal} />
          <Text style={styles.clockInText}>Clock In</Text>
        </Pressable>

        <View style={styles.illustrationWrap}>
          <HouseFrameIllustration />
          <Text style={styles.emptyText}>No Clock-Ins yet</Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <Pressable style={({ pressed }) => [styles.addTimeFab, pressed && { opacity: 0.9 }]}>
        <Text style={styles.addTimeText}>Add Time</Text>
        <View style={styles.addTimeDivider} />
        <ClockPlus color={COLORS.white} />
      </Pressable>
    </SafeAreaView>
  );
}

function HeaderIconBtn({ children }) {
  return <Pressable hitSlop={8} style={styles.headerIconBtn}>{children}</Pressable>;
}

function formatAddedDate(project) {
  const value = project?.companycam_updated_at || project?.last_synced_at;
  if (!value) return "recently";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "recently";
  }
}

function ChevronLeft({ color }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderLeftWidth: 2,
          borderBottomWidth: 2,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

function NotifIcon({ color }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 12,
          height: 13,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          borderWidth: 1.6,
          borderColor: color,
          borderBottomWidth: 0,
        }}
      />
      <View style={{ width: 14, height: 1.6, backgroundColor: color, marginTop: -0.4, borderRadius: 1 }} />
      <View
        style={{
          position: "absolute",
          width: 12,
          height: 1.6,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: "-28deg" }],
          top: 9,
        }}
      />
    </View>
  );
}

function PencilIcon({ color }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 14,
          height: 3,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: "-45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 4,
          height: 3,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: "-45deg" }],
          bottom: 3,
          left: 3,
        }}
      />
    </View>
  );
}

function ShareIcon({ color }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", bottom: 2, width: 14, height: 7, borderTopWidth: 1.6, borderLeftWidth: 1.6, borderRightWidth: 1.6, borderColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
      <View style={{ position: "absolute", top: 2, width: 1.8, height: 10, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: "absolute", top: 2, width: 7, height: 7, borderTopWidth: 1.8, borderLeftWidth: 1.8, borderColor: color, transform: [{ rotate: "45deg" }], top: 3 }} />
    </View>
  );
}

function TabIcon({ name, color }) {
  if (name === "clock") {
    return (
      <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.6, borderColor: color }} />
        <View style={{ position: "absolute", width: 1.4, height: 5, backgroundColor: color, top: 3.5, borderRadius: 1 }} />
        <View style={{ position: "absolute", width: 4, height: 1.4, backgroundColor: color, top: 7.5, left: 8, borderRadius: 1 }} />
      </View>
    );
  }
  if (name === "pin") {
    return (
      <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.6, borderColor: color }} />
        <View style={{ position: "absolute", width: 4, height: 4, backgroundColor: color, transform: [{ rotate: "45deg" }], bottom: 1 }} />
        <View style={{ position: "absolute", width: 3, height: 3, borderRadius: 1.5, backgroundColor: COLORS.white, top: 4 }} />
      </View>
    );
  }
  if (name === "photo") {
    return (
      <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 14, height: 11, borderWidth: 1.6, borderColor: color, borderRadius: 2 }} />
        <View style={{ position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: color, top: 4, left: 3 }} />
        <View style={{ position: "absolute", width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 5, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color, bottom: 3, right: 2.5 }} />
      </View>
    );
  }
  if (name === "note") {
    return (
      <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 12, height: 14, borderWidth: 1.6, borderColor: color, borderRadius: 2 }}>
          <View style={{ height: 1.4, backgroundColor: color, marginTop: 3, marginHorizontal: 2, borderRadius: 1 }} />
          <View style={{ height: 1.4, backgroundColor: color, marginTop: 2, marginHorizontal: 2, borderRadius: 1 }} />
          <View style={{ height: 1.4, backgroundColor: color, marginTop: 2, marginHorizontal: 2, marginRight: 6, borderRadius: 1 }} />
        </View>
      </View>
    );
  }
  if (name === "list") {
    return (
      <View style={{ width: 18, height: 16, justifyContent: "space-between", paddingVertical: 2 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 4, height: 4, borderRadius: 1, backgroundColor: color }} />
            <View style={{ flex: 1, height: 1.6, backgroundColor: color, borderRadius: 1 }} />
          </View>
        ))}
      </View>
    );
  }
  return null;
}

function MapCard() {
  return (
    <View style={styles.mapCard}>
      <View style={styles.mapBase} />

      <View style={[styles.mapRoad, { top: 24, left: -10, right: -10, transform: [{ rotate: "-8deg" }] }]} />
      <View style={[styles.mapRoad, { top: 70, left: -20, right: -20, transform: [{ rotate: "4deg" }] }]} />
      <View style={[styles.mapRoad, { top: 118, left: -10, right: -10, transform: [{ rotate: "-3deg" }] }]} />
      <View style={[styles.mapRoadV, { left: 80, top: -10, bottom: -10, transform: [{ rotate: "10deg" }] }]} />
      <View style={[styles.mapRoadV, { left: 200, top: -10, bottom: -10, transform: [{ rotate: "-6deg" }] }]} />

      <View style={[styles.mapBlock, { backgroundColor: "#dfeed7", top: 6, left: 6, width: 60, height: 28, transform: [{ rotate: "-8deg" }] }]} />
      <View style={[styles.mapBlock, { backgroundColor: "#e9efe2", top: 36, left: 90, width: 80, height: 22, transform: [{ rotate: "3deg" }] }]} />
      <View style={[styles.mapBlock, { backgroundColor: "#e2ecdf", bottom: 12, right: 8, width: 70, height: 30, transform: [{ rotate: "-4deg" }] }]} />
      <View style={[styles.mapBlock, { backgroundColor: "#eef3ea", bottom: 18, left: 14, width: 56, height: 24 }]} />

      <View style={styles.mapPinHalo}>
        <View style={styles.mapPinDot} />
      </View>

      <View style={styles.mapBadge}>
        <Text style={styles.mapBadgeText}>17</Text>
      </View>

      <View style={styles.mapLabelLeft}>
        <Text style={styles.mapLabelText}>Maps</Text>
      </View>
      <View style={styles.mapLabelLegal}>
        <Text style={styles.mapLegalText}>Legal</Text>
      </View>
    </View>
  );
}

function PlayCircle({ color }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.8, borderColor: color, alignItems: "center", justifyContent: "center" }}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 7,
            borderTopWidth: 5,
            borderBottomWidth: 5,
            borderLeftColor: color,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            marginLeft: 3,
          }}
        />
      </View>
    </View>
  );
}

function ClockPlus({ color }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.8, borderColor: color }} />
      <View style={{ position: "absolute", width: 1.6, height: 6, backgroundColor: color, top: 4.5, left: 10.2, borderRadius: 1 }} />
      <View style={{ position: "absolute", width: 5, height: 1.6, backgroundColor: color, top: 9, left: 10.5, borderRadius: 1 }} />
    </View>
  );
}

function HouseFrameIllustration() {
  return (
    <View style={styles.illustration}>
      <View style={styles.cloud1} />
      <View style={styles.cloud2} />

      <View style={styles.frameBase} />

      <View style={[styles.frameStud, { left: 22 }]} />
      <View style={[styles.frameStud, { left: 92 }]} />
      <View style={[styles.frameStud, { left: 156 }]} />
      <View style={[styles.frameStud, { left: 220 }]} />

      <View style={styles.frameHeader} />

      <View style={styles.roofLeft} />
      <View style={styles.roofRight} />
      <View style={styles.roofPeak} />

      <View style={[styles.crossBeam, { transform: [{ rotate: "32deg" }], left: 110, top: 70 }]} />
      <View style={[styles.crossBeam, { transform: [{ rotate: "-32deg" }], left: 170, top: 70 }]} />

      <View style={[styles.worker, { left: 70 }]}>
        <View style={[styles.hardHat, { backgroundColor: "#f5c64a" }]} />
        <View style={styles.workerHead} />
        <View style={[styles.workerBody, { backgroundColor: "#2f6fbb" }]} />
        <View style={[styles.workerLeg, { left: 4 }]} />
        <View style={[styles.workerLeg, { right: 4 }]} />
      </View>
      <View style={[styles.worker, { left: 110 }]}>
        <View style={[styles.hardHat, { backgroundColor: "#f5c64a" }]} />
        <View style={styles.workerHead} />
        <View style={[styles.workerBody, { backgroundColor: "#2f6fbb" }]} />
        <View style={[styles.workerLeg, { left: 4 }]} />
        <View style={[styles.workerLeg, { right: 4 }]} />
      </View>

      <View style={[styles.bush, { left: 16, bottom: 18 }]} />
      <View style={[styles.bush, { right: 22, bottom: 14, backgroundColor: "#bcdce0" }]} />
      <View style={[styles.bush, { right: 60, bottom: 22, width: 26, height: 36, backgroundColor: "#cfe3e7" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 10,
  },
  backBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  projectSub: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "500",
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerIconBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  tabRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 6,
    paddingBottom: 14,
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 38,
  },
  tabPillActive: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  tabPillSquare: {
    paddingHorizontal: 12,
  },
  tabLabel: {
    color: COLORS.ink,
    fontSize: 13.5,
    fontWeight: "800",
  },
  tabLabelActive: {
    color: COLORS.white,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  mapCard: {
    height: 170,
    borderRadius: 14,
    backgroundColor: "#e7efe1",
    overflow: "hidden",
    position: "relative",
    marginBottom: 18,
  },
  mapBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#eef3ea",
  },
  mapRoad: {
    position: "absolute",
    height: 6,
    backgroundColor: COLORS.white,
  },
  mapRoadV: {
    position: "absolute",
    width: 6,
    backgroundColor: COLORS.white,
  },
  mapBlock: {
    position: "absolute",
    borderRadius: 4,
  },
  mapPinHalo: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(47,141,127,0.18)",
    marginLeft: -23,
    marginTop: -23,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPinDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.teal,
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  mapBadge: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
    top: "50%",
    left: "50%",
    marginLeft: -34,
    marginTop: 4,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  mapBadgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "900",
  },
  mapLabelLeft: {
    position: "absolute",
    bottom: 6,
    left: 8,
  },
  mapLabelText: {
    color: COLORS.ink,
    fontSize: 10,
    fontWeight: "700",
    opacity: 0.7,
  },
  mapLabelLegal: {
    position: "absolute",
    bottom: 6,
    left: 50,
  },
  mapLegalText: {
    color: COLORS.ink,
    fontSize: 9,
    fontWeight: "600",
    opacity: 0.55,
  },
  clockInBtn: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1.4,
    borderColor: "#bfd9d3",
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  clockInText: {
    color: COLORS.teal,
    fontSize: 16,
    fontWeight: "800",
  },
  illustrationWrap: {
    alignItems: "center",
    marginTop: 6,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
  },
  illustration: {
    width: 280,
    height: 200,
    position: "relative",
  },
  cloud1: {
    position: "absolute",
    width: 90,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e2eef4",
    top: 14,
    left: 30,
    opacity: 0.7,
  },
  cloud2: {
    position: "absolute",
    width: 70,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#e2eef4",
    top: 30,
    right: 14,
    opacity: 0.7,
  },
  frameBase: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    height: 6,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
  },
  frameStud: {
    position: "absolute",
    width: 6,
    height: 90,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
    bottom: 18,
  },
  frameHeader: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 64,
    height: 6,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
  },
  roofLeft: {
    position: "absolute",
    left: 18,
    top: 62,
    width: 100,
    height: 6,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
    transform: [{ rotate: "-25deg" }],
    transformOrigin: "left center",
  },
  roofRight: {
    position: "absolute",
    right: 18,
    top: 62,
    width: 100,
    height: 6,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
    transform: [{ rotate: "25deg" }],
    transformOrigin: "right center",
  },
  roofPeak: {
    position: "absolute",
    left: 130,
    top: 18,
    width: 18,
    height: 6,
    backgroundColor: "#e8b8a8",
    borderRadius: 2,
  },
  crossBeam: {
    position: "absolute",
    width: 70,
    height: 5,
    backgroundColor: "#edc4b6",
    borderRadius: 2,
  },
  worker: {
    position: "absolute",
    bottom: 24,
    width: 22,
    height: 50,
    alignItems: "center",
  },
  hardHat: {
    width: 16,
    height: 6,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    marginBottom: -1,
  },
  workerHead: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#f1c79a",
  },
  workerBody: {
    width: 18,
    height: 14,
    borderRadius: 4,
    marginTop: 2,
  },
  workerLeg: {
    position: "absolute",
    bottom: 0,
    width: 5,
    height: 10,
    backgroundColor: "#3a3a3a",
    borderRadius: 2,
  },
  bush: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#bcdce0",
  },
  addTimeFab: {
    position: "absolute",
    right: 16,
    bottom: 22,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.green,
    paddingLeft: 22,
    paddingRight: 18,
    height: 56,
    borderRadius: 28,
    gap: 12,
    shadowColor: COLORS.green,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  addTimeText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  addTimeDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
