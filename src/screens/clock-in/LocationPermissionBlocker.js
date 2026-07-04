import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const COLORS = {
  teal: "#2f8d7f",
  navy: "#31495d",
  white: "#ffffff",
  ink: "#11201d",
  muted: "#8b9692",
  border: "#e0e3e1",
};

export function shouldOpenSettingsAfterPermissionRequest(permissions) {
  if (Platform.OS === "web") return false;
  if (!permissions || permissions.ready) return false;
  const foregroundDenied = permissions.foregroundStatus === "denied" || !permissions.canAskForegroundAgain;
  const backgroundDenied =
    permissions.foreground &&
    !permissions.background &&
    (permissions.backgroundStatus === "denied" || !permissions.canAskBackgroundAgain);
  return foregroundDenied || backgroundDenied || (permissions.foreground && !permissions.background);
}

export default function LocationPermissionBlocker({
  permissions,
  isClockedIn,
  projectName,
  onEnable,
  onOpenSettings,
  onCheckAgain,
  onClockOut,
  onDevBypass,
}) {
  const isWeb = Platform.OS === "web";
  const checking = !permissions;
  const missingForeground = permissions && !permissions.foreground;
  const missingBackground = permissions?.foreground && !permissions.background;
  const foregroundDenied =
    missingForeground && (permissions.foregroundStatus === "denied" || !permissions.canAskForegroundAgain);
  const backgroundDenied =
    missingBackground && (permissions.backgroundStatus === "denied" || !permissions.canAskBackgroundAgain);
  const canAskAgain =
    missingForeground ? permissions.canAskForegroundAgain : missingBackground ? permissions.canAskBackgroundAgain : true;
  const deniedOrBlocked = foregroundDenied || backgroundDenied || !canAskAgain;
  const shouldOpenSettings = !isWeb && !checking && deniedOrBlocked;
  const shouldCheckBrowserPermissions = isWeb && !checking && deniedOrBlocked;
  const primaryLabel = checking ? "Checking..." : shouldOpenSettings ? "Open Settings" : shouldCheckBrowserPermissions ? "Check again" : "Enable location";
  const primaryAction = checking ? onCheckAgain : shouldOpenSettings ? onOpenSettings : shouldCheckBrowserPermissions ? onCheckAgain : onEnable;
  const foregroundReady = !!permissions?.foreground;
  const backgroundReady = isWeb ? foregroundReady : !!permissions?.background;
  const foregroundLabel = isWeb ? "Browser location" : "Location access";
  const backgroundLabel = isWeb ? "Session tracking" : "Always-on tracking";
  let title = isWeb ? "Turn on browser location" : "Set location to Always";
  let message = isWeb
    ? "Allow location for this site when your browser asks."
    : "Shifts keep tracking even when the app is closed.";

  if (checking) {
    title = "Checking access";
    message = "Confirming location access...";
  } else if (foregroundDenied) {
    title = isWeb ? "Location blocked" : "Location denied";
    message = isWeb
      ? "Allow location for this site in your browser's site settings, then check again."
      : "Open Settings and turn location back on.";
  } else if (backgroundDenied) {
    title = isWeb ? "Browser location blocked" : "Always location denied";
    message = isWeb
      ? "Allow location for this site in your browser's site settings, then check again."
      : "Open Settings and set Location to Always before clocking in.";
  } else if (missingForeground) {
    title = isWeb ? "Turn on browser location" : "Turn on location";
    message = isWeb
      ? "ServiceFlow needs browser location access to start a shift."
      : "ServiceFlow needs location to start a shift.";
  } else if (isWeb && missingBackground) {
    title = "Keep this tab open";
    message = "Web clock-ins can track location only while this browser tab stays open.";
  }

  return (
    <View style={styles.permissionScreen}>
      <ScrollView
        contentContainerStyle={styles.permissionScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.permissionIcon}>
          {checking ? (
            <ActivityIndicator color={COLORS.teal} />
          ) : (
            <Ionicons name="location" size={34} color={COLORS.teal} />
          )}
        </View>

        <Text style={styles.permissionTitle}>{title}</Text>
        <Text style={styles.permissionBody}>{message}</Text>

        {isClockedIn && projectName ? (
          <Text style={styles.permissionProjectText} numberOfLines={1}>
            Active job - {projectName}
          </Text>
        ) : null}

        <View style={styles.permissionStatusList}>
          <PermissionStatusRow
            label={foregroundLabel}
            ready={foregroundReady}
            blocked={!checking && !foregroundReady}
          />
          <PermissionStatusRow
            label={backgroundLabel}
            ready={backgroundReady}
            blocked={!checking && foregroundReady && !backgroundReady}
          />
        </View>

        <Pressable style={styles.permissionPrimaryButton} onPress={primaryAction} disabled={checking}>
          <Text style={styles.permissionPrimaryText}>{primaryLabel}</Text>
        </Pressable>

        {!checking && !isWeb ? (
          <Pressable
            style={styles.permissionLink}
            onPress={shouldOpenSettings ? onCheckAgain : onOpenSettings}
          >
            <Text style={styles.permissionLinkText}>
              {shouldOpenSettings ? "Check again" : "Open Settings"}
            </Text>
          </Pressable>
        ) : null}

        {foregroundDenied || backgroundDenied ? (
          <Text style={styles.permissionDeniedHint}>
            {isWeb
              ? "After blocking location, use your browser's site settings to allow it for this page."
              : "After permission is denied, use Settings to turn it back on."}
          </Text>
        ) : null}

        {onClockOut ? (
          <Pressable style={styles.permissionClockOut} onPress={onClockOut}>
            <Text style={styles.permissionClockOutText}>Clock out</Text>
          </Pressable>
        ) : null}

        {onDevBypass ? (
          <Pressable style={styles.permissionDevBypass} onPress={onDevBypass}>
            <Text style={styles.permissionDevBypassText}>Skip for now (dev only)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PermissionStatusRow({ label, ready, blocked }) {
  const tint = ready ? COLORS.teal : blocked ? "#c47a3d" : COLORS.muted;
  return (
    <View style={styles.permissionStatusRow}>
      <Ionicons
        name={ready ? "checkmark-circle" : blocked ? "alert-circle" : "ellipse-outline"}
        size={20}
        color={tint}
      />
      <Text style={styles.permissionStatusLabel}>{label}</Text>
      <Text style={[styles.permissionStatusState, { color: tint }]}>
        {ready ? "On" : blocked ? "Needed" : "-"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  permissionScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  permissionScroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 96,
    justifyContent: "center",
    alignItems: "center",
  },
  permissionIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#e9f3ee",
    alignItems: "center",
    justifyContent: "center",
  },
  permissionTitle: {
    color: COLORS.ink,
    fontSize: 23,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 22,
  },
  permissionBody: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
  },
  permissionProjectText: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 12,
    maxWidth: 300,
  },
  permissionStatusList: {
    alignSelf: "stretch",
    marginTop: 26,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
  },
  permissionStatusRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  permissionStatusLabel: {
    flex: 1,
    minWidth: 0,
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  permissionStatusState: {
    fontSize: 13,
    fontWeight: "900",
  },
  permissionPrimaryButton: {
    alignSelf: "stretch",
    height: 54,
    marginTop: 26,
    borderRadius: 16,
    backgroundColor: COLORS.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionPrimaryText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "900",
  },
  permissionLink: {
    marginTop: 18,
    paddingVertical: 4,
  },
  permissionLinkText: {
    color: COLORS.teal,
    fontSize: 14,
    fontWeight: "800",
  },
  permissionDeniedHint: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 300,
  },
  permissionClockOut: {
    marginTop: 22,
    paddingVertical: 4,
  },
  permissionClockOutText: {
    color: "#c0524f",
    fontSize: 14,
    fontWeight: "800",
  },
  permissionDevBypass: {
    marginTop: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: "dashed",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  permissionDevBypassText: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "700",
  },
});
