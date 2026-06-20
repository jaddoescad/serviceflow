import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Linking,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import LoginScreen from "./src/screens/LoginScreen";
import ProjectsScreen from "./src/screens/ProjectsScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import ClockInScreen from "./src/screens/ClockInScreen";
import TimesheetScreen from "./src/screens/TimesheetScreen";
import LocationPermissionBlocker, {
  shouldOpenSettingsAfterPermissionRequest,
} from "./src/screens/clock-in/LocationPermissionBlocker";
import { supabase } from "./src/lib/supabase";
import { useTimeTracking } from "./src/lib/timeTracking";
import { useEmployeeProjectContext } from "./src/lib/useEmployeeProjectContext";

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
  { key: "clock", label: "Clock In", icon: "clock" },
  { key: "projects", label: "Projects", icon: "projects" },
  { key: "timesheet", label: "Timesheet", icon: "timesheet" },
  { key: "more", label: "More", icon: "more" },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("clock");
  const [selectedProject, setSelectedProject] = useState(null);
  const [devBypassLocationGate, setDevBypassLocationGate] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setActiveTab("clock");
        setSelectedProject(null);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  const {
    sessionUser,
    trackingProjects,
    employeeProfile,
    assignedProjectIds,
    painterName,
    refreshProjectData,
  } = useEmployeeProjectContext(session);

  const tracking = useTimeTracking(trackingProjects, sessionUser);

  if (loading) {
    return (
      <View style={styles.bootScreen}>
        <ActivityIndicator color={COLORS.teal} />
      </View>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!tracking.trackingPermissions?.ready && !devBypassLocationGate) {
    const openLocationSettings = () => Linking.openSettings().catch(() => {});
    const enableLocation = async () => {
      const nextPermissions = await tracking.requestTrackingPermissionAccess?.();
      if (shouldOpenSettingsAfterPermissionRequest(nextPermissions)) {
        openLocationSettings();
      }
    };

    return (
      <SafeAreaView style={styles.shell}>
        <LocationPermissionBlocker
          permissions={tracking.trackingPermissions}
          isClockedIn={!!tracking.activeShift}
          projectName={tracking.activeShift?.project?.name}
          onEnable={enableLocation}
          onOpenSettings={openLocationSettings}
          onCheckAgain={tracking.refreshTrackingPermissions}
          onClockOut={tracking.activeShift ? () => tracking.clockOut("manual") : null}
          onDevBypass={__DEV__ ? () => setDevBypassLocationGate(true) : null}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.content}>
        <View
          style={[styles.tabScene, activeTab !== "clock" && styles.hiddenScene]}
          pointerEvents={activeTab === "clock" ? "auto" : "none"}
        >
          <ClockInScreen
            painterName={painterName}
            onViewProject={setSelectedProject}
            activeShift={tracking.activeShift}
            activeElapsedMs={tracking.activeElapsedMs}
            todayWorkedMs={tracking.todayWorkedMs}
            locationStatus={tracking.locationStatus}
            trackingNotice={tracking.trackingNotice}
            trackingPermissions={tracking.trackingPermissions}
            suggestedProject={tracking.suggestedProject}
            projects={tracking.resolvedProjects}
            onClockIn={tracking.clockIn}
            onClockOut={tracking.clockOut}
            onSwitchProject={tracking.switchProject}
            onUpdateTimeEntry={tracking.updateTimeEntry}
          />
        </View>
        <View
          style={[styles.tabScene, activeTab !== "projects" && styles.hiddenScene]}
          pointerEvents={activeTab === "projects" ? "auto" : "none"}
        >
          <ProjectsScreen
            onSelectProject={setSelectedProject}
            activeShift={tracking.activeShift}
            projectTimeTotals={tracking.projectTimeTotals}
            assignedProjectIds={assignedProjectIds}
            onProjectsChanged={refreshProjectData}
          />
        </View>
        <View
          style={[styles.tabScene, activeTab !== "timesheet" && styles.hiddenScene]}
          pointerEvents={activeTab === "timesheet" ? "auto" : "none"}
        >
          <TimesheetScreen
            entries={tracking.entries}
            activeShift={tracking.activeShift}
            projects={trackingProjects}
            painterName={painterName}
            onDeleteTimeEntry={tracking.deleteTimeEntry}
            onUpdateTimeEntry={tracking.updateTimeEntry}
          />
        </View>
        <View
          style={[styles.tabScene, activeTab !== "more" && styles.hiddenScene]}
          pointerEvents={activeTab === "more" ? "auto" : "none"}
        >
          <MoreScreen userEmail={session.user?.email} profile={employeeProfile} />
        </View>
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            icon={t.icon}
            label={t.label}
            active={activeTab === t.key}
            onPress={() => setActiveTab(t.key)}
          />
        ))}
      </View>
      {selectedProject ? (
        <SwipeBackOverlay onBack={() => setSelectedProject(null)}>
          <ProjectDetailScreen
            project={selectedProject}
            onBack={() => setSelectedProject(null)}
            entries={tracking.teamEntries}
            activeShift={tracking.activeShift}
            activeElapsedMs={tracking.activeElapsedMs}
            trackingNotice={tracking.trackingNotice}
            projects={trackingProjects}
            user={session.user}
            onClockIn={tracking.clockIn}
            onClockOut={tracking.clockOut}
            onSwitchProject={tracking.switchProject}
            onDeleteTimeEntry={tracking.deleteTimeEntry}
            onUpdateTimeEntry={tracking.updateTimeEntry}
          />
        </SwipeBackOverlay>
      ) : null}
    </SafeAreaView>
  );
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_EDGE_WIDTH = 40;

function SwipeBackOverlay({ onBack, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture when it starts near the left edge and is clearly
      // a rightward horizontal drag, so vertical scrolling still works.
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gesture.x0 <= SWIPE_EDGE_WIDTH &&
        gesture.dx > 6 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_evt, gesture) => {
        translateX.setValue(Math.max(0, gesture.dx));
      },
      onPanResponderRelease: (_evt, gesture) => {
        const shouldDismiss = gesture.dx > SCREEN_WIDTH * 0.33 || gesture.vx > 0.35;
        if (shouldDismiss) {
          Animated.timing(translateX, {
            toValue: SCREEN_WIDTH,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onBackRef.current?.());
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.detailOverlay, { transform: [{ translateX }] }]}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

function TabButton({ icon, label, active, onPress }) {
  const color = active ? COLORS.green : COLORS.muted;
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <TabIcon name={icon} color={color} />
      <Text style={[styles.tabText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function TabIcon({ name, color }) {
  const iconNames = {
    clock: "time-outline",
    projects: "folder",
    timesheet: "reader-outline",
    more: "ellipsis-horizontal",
  };

  return <Ionicons name={iconNames[name] || "ellipse-outline"} size={27} color={color} />;
}

function PlaceholderScreen({ title }) {
  return (
    <View style={styles.placeholderScreen}>
      <Text style={styles.placeholderKicker}>Ottawa Painters</Text>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderText}>Coming soon.</Text>
    </View>
  );
}

function MoreScreen({ userEmail }) {
  return (
    <View style={styles.moreScreen}>
      <Text style={styles.placeholderKicker}>Ottawa Painters</Text>
      <Text style={styles.placeholderTitle}>More</Text>
      <View style={styles.moreCard}>
        <Text style={styles.moreLabel}>Signed in as</Text>
        <Text style={styles.moreEmail}>{userEmail}</Text>
      </View>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  content: {
    flex: 1,
  },
  tabScene: {
    flex: 1,
  },
  hiddenScene: {
    display: "none",
  },
  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    elevation: 20,
    backgroundColor: COLORS.white,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    gap: 4,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  placeholderScreen: {
    flex: 1,
    padding: 24,
    paddingTop: 36,
    backgroundColor: COLORS.white,
  },
  moreScreen: {
    flex: 1,
    padding: 24,
    paddingTop: 36,
    backgroundColor: COLORS.white,
  },
  placeholderKicker: {
    color: COLORS.teal,
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  placeholderTitle: {
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
    marginBottom: 16,
  },
  placeholderText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: "500",
  },
  moreCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginTop: 12,
    marginBottom: 18,
  },
  moreLabel: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  moreEmail: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  signOutButton: {
    height: 54,
    borderRadius: 18,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "900",
  },
});

const iconStyle = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.8,
  },
  handV: {
    position: "absolute",
    width: 1.8,
    height: 7,
    borderRadius: 1,
    top: 5,
    left: 11.1,
  },
  handH: {
    position: "absolute",
    width: 6,
    height: 1.8,
    borderRadius: 1,
    top: 11.1,
    left: 11.1,
  },
  folderTab: {
    position: "absolute",
    width: 9,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    top: 4,
    left: 3,
  },
  folderBody: {
    position: "absolute",
    width: 20,
    height: 13,
    borderRadius: 3,
    top: 7,
    left: 2,
  },
  sheet: {
    width: 16,
    height: 20,
    borderWidth: 1.6,
    borderRadius: 2,
    position: "relative",
  },
  sheetLine: {
    position: "absolute",
    left: 2.5,
    height: 1.4,
    width: 10,
    borderRadius: 1,
  },
  head: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    top: 4,
  },
  bodyLeft: {
    position: "absolute",
    width: 9,
    height: 7,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    bottom: 4,
    left: 1.5,
  },
  bodyRight: {
    position: "absolute",
    width: 9,
    height: 7,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    bottom: 4,
    right: 1.5,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
