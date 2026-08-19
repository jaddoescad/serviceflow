import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import LoginScreen from "./src/screens/LoginScreen";
import ProjectsScreen from "./src/screens/ProjectsScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import ClockInScreen from "./src/screens/ClockInScreen";
import TimesheetScreen from "./src/screens/TimesheetScreen";
import TeamMapScreen from "./src/screens/TeamMapScreen";
import { supabase } from "./src/lib/supabase";
import { useTimeTracking } from "./src/lib/timeTracking";
import { useEmployeeProjectContext } from "./src/lib/useEmployeeProjectContext";
import { registerPushToken } from "./src/lib/pushTokenRegistration";
import { isLocationTrackingFeatureEnabled } from "./src/lib/locationTrackingFeature";
import { palette as COLORS } from "./src/theme";
import UpdateReadyPrompt from "./src/components/UpdateReadyPrompt";

const Stack = createNativeStackNavigator();

const BASE_TABS = [
  { key: "clock", label: "Clock In", icon: "clock" },
  { key: "projects", label: "Jobs", icon: "projects" },
  { key: "timesheet", label: "Timesheet", icon: "timesheet" },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={COLORS.white} />
      <AppRoot />
      <UpdateReadyPrompt />
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("clock");
  const [selectedProject, setSelectedProject] = useState(null);
  const navigationRef = useNavigationContainerRef();
  // The navigation object handed to the Main screen. Preferred over the
  // container ref, which only works once the container reports ready.
  const mainNavigationRef = useRef(null);

  const openProject = useCallback(
    (project) => {
      if (!project) return;
      setSelectedProject(project);
      const navigator = mainNavigationRef.current ?? navigationRef;
      console.info("[nav] openProject", {
        project: project?.name,
        viaScreen: Boolean(mainNavigationRef.current),
        containerReady: navigationRef?.isReady?.() ?? null,
      });
      try {
        navigator.navigate("ProjectDetail");
        console.info("[nav] navigate dispatched");
      } catch (navError) {
        console.error("[nav] navigate threw", navError?.message);
      }
    },
    [navigationRef],
  );
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const insets = useSafeAreaInsets();

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

  useEffect(() => {
    if (!session?.user?.id) {
      setMaintenanceMode(false);
      return;
    }
    supabase
      .from("app_config")
      .select("maintenance_mode")
      .eq("id", "default")
      .maybeSingle()
      .then(({ data }) => setMaintenanceMode(data?.maintenance_mode === true));
  }, [session?.user?.id]);

  const {
    sessionUser,
    trackingProjects,
    employeeProfile,
    assignedProjectIds,
    painterName,
    refreshProjectData,
  } = useEmployeeProjectContext(session);

  const canManageProjects = ["admin", "manager"].includes(employeeProfile?.role);
  const canViewTeamMap = canManageProjects && isLocationTrackingFeatureEnabled();
  const tracking = useTimeTracking(trackingProjects, sessionUser);
  // Shared "shift is ending" flag so screens can hide live-shift UI (e.g. the
  // Current clock-in banner) instead of flashing it while clock-out settles.
  const [clockOutPending, setClockOutPending] = useState(false);
  const clockOutWithPending = useCallback(
    async (reason) => {
      setClockOutPending(true);
      try {
        return await tracking.clockOut(reason);
      } finally {
        setClockOutPending(false);
      }
    },
    [tracking.clockOut],
  );
  const tabs = canViewTeamMap
    ? [...BASE_TABS, { key: "teamMap", label: "Team Map", icon: "map" }, { key: "more", label: "More", icon: "more" }]
    : [...BASE_TABS, { key: "more", label: "More", icon: "more" }];

  useEffect(() => {
    if (!sessionUser?.id) return;
    registerPushToken(sessionUser).catch(() => {});
  }, [sessionUser?.id]);

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

  if (maintenanceMode) {
    return (
      <View style={styles.maintenanceScreen}>
        <Text style={styles.maintenanceTitle}>Database upgrade in progress</Text>
        <Text style={styles.maintenanceBody}>ServiceFlow is temporarily paused while your jobs and time records are verified. Please try again shortly.</Text>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.content, { paddingTop: insets.top }]}>
        <View
          style={[styles.tabScene, activeTab !== "clock" && styles.hiddenScene]}
        >
          <ClockInScreen
            enabled={activeTab === "clock" && !selectedProject}
            user={session.user}
            painterName={painterName}
            onViewProject={openProject}
            activeShift={tracking.activeShift}
            activeElapsedMs={tracking.activeElapsedMs}
            todayWorkedMs={tracking.todayWorkedMs}
            locationStatus={tracking.locationStatus}
            trackingNotice={tracking.trackingNotice}
            trackingPermissions={tracking.trackingPermissions}
            suggestedProject={tracking.suggestedProject}
            projects={tracking.resolvedProjects}
            onClockIn={tracking.clockIn}
            onClockOut={clockOutWithPending}
            onSwitchProject={tracking.switchProject}
            onUpdateTimeEntry={tracking.updateTimeEntry}
          />
        </View>
        <View
          style={[styles.tabScene, activeTab !== "projects" && styles.hiddenScene]}
        >
          <ProjectsScreen
            enabled={activeTab === "projects" && !selectedProject}
            onSelectProject={openProject}
            activeShift={tracking.activeShift}
            projectTimeTotals={tracking.projectTimeTotals}
            myProjectTimeTotals={tracking.myProjectTimeTotals}
            projectLatestActivity={tracking.projectLatestActivity}
            assignedProjectIds={assignedProjectIds}
            canManageProjects={canManageProjects}
            canViewTeamTime={canManageProjects}
            onProjectsChanged={refreshProjectData}
          />
        </View>
        <View
          style={[styles.tabScene, activeTab !== "timesheet" && styles.hiddenScene]}
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
          style={[styles.tabScene, activeTab !== "teamMap" && styles.hiddenScene]}
        >
          {canViewTeamMap ? (
            <TeamMapScreen projects={tracking.resolvedProjects} enabled={activeTab === "teamMap"} />
          ) : null}
        </View>
        <View
          style={[styles.tabScene, activeTab !== "more" && styles.hiddenScene]}
        >
          <MoreScreen
            userEmail={session.user?.email}
            profile={employeeProfile}
            activeShift={tracking.activeShift}
            trackingPermissions={tracking.trackingPermissions}
            trackingDiagnostic={tracking.trackingDiagnostic}
          />
        </View>
      </View>
      <View style={[styles.tabBar, { paddingBottom: insets.bottom + 10 }]}>
        {tabs.map((t) => (
          <TabButton
            key={t.key}
            icon={t.icon}
            label={t.label}
            active={activeTab === t.key}
            onPress={() => setActiveTab(t.key)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // UIKit owns the push animation and its interactive pop gesture, so
          // the edge swipe behaves exactly like every other iOS app.
          gestureEnabled: true,
          contentStyle: { backgroundColor: COLORS.white },
        }}
      >
        <Stack.Screen name="Main">
          {({ navigation }) => {
            mainNavigationRef.current = navigation;
            return mainShell;
          }}
        </Stack.Screen>
        <Stack.Screen name="ProjectDetail">
          {({ navigation }) => (
            <DetailHost
              onDismissed={() => setSelectedProject(null)}
              onMounted={() =>
                console.info("[nav] ProjectDetail mounted", {
                  hasProject: Boolean(selectedProject),
                })
              }
            >
              {selectedProject ? (
                <ProjectDetailScreen
                  project={selectedProject}
                  onBack={() => navigation.goBack()}
                  entries={tracking.teamEntries}
                  activeShift={tracking.activeShift}
                  activeElapsedMs={tracking.activeElapsedMs}
                  clockOutPending={clockOutPending}
                  trackingNotice={tracking.trackingNotice}
                  projects={trackingProjects}
                  user={session.user}
                  canViewTeamTime={canManageProjects}
                  onClockIn={tracking.clockIn}
                  onClockOut={clockOutWithPending}
                  onSwitchProject={tracking.switchProject}
                  onOpenActiveClock={() => {
                    setActiveTab("clock");
                    navigation.goBack();
                  }}
                  onDeleteTimeEntry={tracking.deleteTimeEntry}
                  onUpdateTimeEntry={tracking.updateTimeEntry}
                />
              ) : null}
            </DetailHost>
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// Clears the selected project once UIKit has finished popping the screen so the
// tab screens behind it resume.
function DetailHost({ onDismissed, onMounted, children }) {
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const onMountedRef = useRef(onMounted);
  onMountedRef.current = onMounted;
  useEffect(() => {
    onMountedRef.current?.();
    return () => onDismissedRef.current?.();
  }, []);
  return children;
}

function TabButton({ icon, label, active, onPress }) {
  const color = active ? COLORS.green : COLORS.muted;
  return (
    <Pressable
      style={styles.tabButton}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
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
    map: "map-outline",
    more: "ellipsis-horizontal",
  };

  return <Ionicons name={iconNames[name] || "ellipse-outline"} size={27} color={color} />;
}

function MoreScreen({ userEmail, activeShift, trackingPermissions, trackingDiagnostic }) {
  const lastLocationAt = trackingDiagnostic?.lastLocationAt || activeShift?.lastLocation?.capturedAt;
  return (
    <View style={styles.moreScreen}>
      <Text style={styles.placeholderKicker}>ServiceFlow</Text>
      <Text style={styles.placeholderTitle}>More</Text>
      <View style={styles.moreCard}>
        <Text style={styles.moreLabel}>Signed in as</Text>
        <Text style={styles.moreEmail}>{userEmail}</Text>
      </View>
      <View style={styles.moreCard}>
        <Text style={styles.moreLabel}>Location tracking</Text>
        <View style={styles.diagnosticRow}>
          <View style={[
            styles.diagnosticDot,
            { backgroundColor: activeShift ? COLORS.teal : COLORS.muted },
          ]} />
          <Text style={styles.diagnosticValue}>
            {activeShift ? trackingModeLabel(trackingDiagnostic?.mode) : "Off while clocked out"}
          </Text>
        </View>
        {activeShift ? (
          <>
            <Text style={styles.diagnosticText}>
              Last location: {formatDiagnosticTime(lastLocationAt)}
            </Text>
            <Text style={styles.diagnosticText}>
              Last upload: {formatDiagnosticTime(trackingDiagnostic?.lastSyncAt)}
            </Text>
            <Text style={styles.diagnosticText}>
              Location access: {trackingPermissions?.foreground ? "Active shifts only" : "Not enabled"}
            </Text>
            <Text style={styles.diagnosticText}>
              Tracking may pause if ServiceFlow is force-closed.
            </Text>
            {trackingDiagnostic?.lastErrorCode ? (
              <Text style={styles.diagnosticError}>Issue: {trackingDiagnostic.lastErrorCode}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.diagnosticText}>
            ServiceFlow requests location when you clock in and stops tracking when you clock out.
          </Text>
        )}
      </View>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function trackingModeLabel(mode) {
  return ({
    painting: "On-site tracking active",
    stationary: "Stationary tracking active",
    travel: "Travel tracking active",
    unavailable: "Tracking unavailable",
  })[mode] || "Preparing location tracking";
}

function formatDiagnosticTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "Not received yet";
  return date.toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
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
  maintenanceScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.white,
  },
  maintenanceTitle: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  maintenanceBody: {
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
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
  diagnosticRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 8,
  },
  diagnosticDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  diagnosticValue: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  diagnosticText: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "600",
    marginTop: 4,
  },
  diagnosticError: {
    color: "#a45623",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 7,
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
