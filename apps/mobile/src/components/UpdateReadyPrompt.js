import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette as COLORS } from "../theme";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_CHECK_COOLDOWN_MS = 60 * 1000;

export default function UpdateReadyPrompt() {
  const { isUpdatePending } = Updates.useUpdates();
  const [isRestarting, setIsRestarting] = useState(false);
  const insets = useSafeAreaInsets();
  const checkInFlight = useRef(false);
  const lastCheckAt = useRef(0);

  const checkForUpdate = useCallback(async () => {
    const now = Date.now();
    if (
      __DEV__ ||
      !Updates.isEnabled ||
      isUpdatePending ||
      checkInFlight.current ||
      now - lastCheckAt.current < UPDATE_CHECK_COOLDOWN_MS
    ) {
      return;
    }

    checkInFlight.current = true;
    lastCheckAt.current = now;

    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
      }
    } catch {
      // Update checks are best-effort. The built-in startup check will retry later.
    } finally {
      checkInFlight.current = false;
    }
  }, [isUpdatePending]);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return undefined;

    let previousAppState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const becameActive =
        nextAppState === "active" && previousAppState !== "active";
      previousAppState = nextAppState;

      if (becameActive) {
        checkForUpdate();
      }
    });

    // Run an explicit check on every production launch. The native startup
    // check remains the first line of defence; this guarantees the in-app
    // prompt does not depend on a background/foreground transition or the
    // 15-minute interval before fetching a newly published OTA.
    checkForUpdate();

    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        checkForUpdate();
      }
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const restartWithUpdate = async () => {
    if (isRestarting) return;
    setIsRestarting(true);

    try {
      await Updates.reloadAsync();
    } catch {
      setIsRestarting(false);
      Alert.alert(
        "Unable to restart",
        "Close and reopen ServiceFlow to finish installing the update.",
      );
    }
  };

  if (!isUpdatePending) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: insets.top + 10 }]}
    >
      <View style={styles.prompt} accessibilityLiveRegion="polite">
        <View style={styles.message}>
          <Text style={styles.title}>Update ready</Text>
          <Text style={styles.subtitle}>Restart ServiceFlow to use the latest version.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restart now to install the update"
          disabled={isRestarting}
          onPress={restartWithUpdate}
          style={({ pressed }) => [
            styles.restartButton,
            pressed && styles.restartButtonPressed,
            isRestarting && styles.restartButtonDisabled,
          ]}
        >
          <Text style={styles.restartText}>
            {isRestarting ? "Restarting…" : "Restart now"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
  },
  prompt: {
    width: "94%",
    maxWidth: 560,
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: COLORS.ink,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  message: {
    flex: 1,
  },
  title: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "900",
  },
  subtitle: {
    color: "#DDE6E3",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  restartButton: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.teal,
  },
  restartButtonPressed: {
    opacity: 0.8,
  },
  restartButtonDisabled: {
    opacity: 0.6,
  },
  restartText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "900",
  },
});
