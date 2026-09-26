import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TEAL = "#2f8d7f";
const INK = "#11201d";
const MUTED = "#8b9692";
const BORDER = "#e0e3e1";
const WARNING = "#b56025";
const WHITE = "#ffffff";

export const OVER_BUDGET_REASONS = [
  { key: "budget_unrealistic", label: "The budget was too tight", icon: "hourglass-outline" },
  { key: "extra_prep", label: "Extra prep or repairs", icon: "construct-outline" },
  { key: "moving_furniture", label: "Moving furniture or covering", icon: "cube-outline" },
  { key: "waiting", label: "Waiting on materials or client", icon: "pause-circle-outline" },
  { key: "other", label: "Something else", icon: "chatbubble-ellipses-outline" },
];

function formatHours(value) {
  const hours = Math.max(0, Number(value) || 0);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

export default function OverBudgetReasonSheet({
  task,
  hoursOver = 0,
  onSubmit,
  onSkip,
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const needsNote = selected === "other";
  const canSubmit = Boolean(selected) && (!needsNote || note.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await onSubmit?.({ reason: selected, note: note.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onSkip}>
      <KeyboardAvoidingView
        style={[
          styles.backdrop,
          {
            paddingTop: insets.top + 10,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardScrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
          <View style={styles.badge}>
            <Ionicons name="alert-circle" size={18} color={WARNING} />
            <Text style={styles.badgeText}>
              {hoursOver > 0 ? `${formatHours(hoursOver)} over budget` : "Over budget"}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {task?.title || "This task"} took longer than planned
          </Text>
          <Text style={styles.subtitle}>
            What slowed it down? This helps us quote the next job better — it is
            not a performance review.
          </Text>

          <View style={styles.options}>
            {OVER_BUDGET_REASONS.map((option) => {
              const active = selected === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.option, active && styles.optionActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  disabled={saving}
                  onPress={() => setSelected(active ? null : option.key)}
                >
                  <Ionicons
                    name={option.icon}
                    size={17}
                    color={active ? TEAL : MUTED}
                  />
                  <Text
                    style={[styles.optionText, active && styles.optionTextActive]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={active ? TEAL : BORDER}
                  />
                </Pressable>
              );
            })}
          </View>

          {needsNote ? (
            <TextInput
              style={styles.noteInput}
              placeholder="Tell us what happened…"
              placeholderTextColor={MUTED}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={280}
              editable={!saving}
              autoFocus
            />
          ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={styles.skipButton}
              accessibilityRole="button"
              disabled={saving}
              onPress={onSkip}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            <Pressable
              style={[styles.submitButton, (!canSubmit || saving) && styles.submitDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send reason"
              disabled={!canSubmit || saving}
              onPress={submit}
            >
              {saving ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Text style={styles.submitText}>Send</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(17, 32, 29, 0.45)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "100%",
    borderRadius: 16,
    backgroundColor: WHITE,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  cardScroll: {
    flexGrow: 0,
  },
  cardScrollContent: {
    paddingBottom: 2,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#fbf1e8",
  },
  badgeText: {
    color: WARNING,
    fontSize: 11.5,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  title: {
    marginTop: 10,
    color: INK,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 17,
  },
  options: {
    marginTop: 13,
    gap: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  optionActive: {
    borderColor: "#b9d6cd",
    backgroundColor: "#f2f9f7",
  },
  optionText: {
    flex: 1,
    color: INK,
    fontSize: 13.5,
    fontWeight: "700",
  },
  optionTextActive: {
    color: TEAL,
  },
  noteInput: {
    marginTop: 10,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    color: INK,
    fontSize: 13.5,
    lineHeight: 18,
    textAlignVertical: "top",
  },
  actions: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  skipButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  skipText: {
    color: MUTED,
    fontSize: 13.5,
    fontWeight: "800",
  },
  submitButton: {
    minWidth: 84,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: WHITE,
    fontSize: 13.5,
    fontWeight: "900",
  },
});
