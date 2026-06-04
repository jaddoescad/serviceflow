import React from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

const contactRows = [
  { label: "Phone", value: "+1 (613) 555-0183", action: () => Linking.openURL("tel:+16135550183") },
  { label: "Email", value: "hello@ottawapainters.com", action: () => Linking.openURL("mailto:hello@ottawapainters.com") },
  { label: "Instagram", value: "@ottawapainters", action: () => Linking.openURL("https://www.instagram.com") },
  { label: "Facebook", value: "Ottawa Painters", action: () => Linking.openURL("https://www.facebook.com") },
  { label: "Address", value: "123 Elgin St, Ottawa, ON", action: () => Linking.openURL("https://maps.google.com/?q=Ottawa+Paints") }
];

export default function ContactScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Contact</Text>
      <Text style={styles.subtext}>Reach us directly for scheduling and estimates.</Text>

      <View style={styles.card}>
        {contactRows.map((item) => (
          <TouchableOpacity key={item.label} style={styles.row} onPress={item.action}>
            <View>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.value}>{item.value}</Text>
            </View>
            <Text style={styles.chevron}>↗</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Hours</Text>
        <Text style={styles.noteText}>Mon - Fri: 8:00 AM – 6:00 PM</Text>
        <Text style={styles.noteText}>Saturday: 9:00 AM – 3:00 PM</Text>
        <Text style={styles.noteText}>Sunday: Closed</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: spacing.md,
    paddingBottom: 36
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.primary,
    marginBottom: spacing.sm
  },
  subtext: {
    color: colors.muted,
    marginBottom: spacing.md
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden"
  },
  row: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 2
  },
  value: {
    color: colors.muted
  },
  chevron: {
    color: colors.primary,
    fontWeight: "700"
  },
  noteCard: {
    marginTop: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    backgroundColor: colors.card
  },
  noteTitle: {
    fontWeight: "700",
    marginBottom: spacing.sm
  },
  noteText: {
    color: colors.muted,
    marginBottom: 4
  }
});
