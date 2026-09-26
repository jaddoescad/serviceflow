import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";

const services = [
  {
    title: "Interior Painting",
    detail: "Wallpaper prep, base coat, premium low-VOC paints, and cleanup included."
  },
  {
    title: "Exterior Painting",
    detail: "Pressure wash, scraping, caulking, primer, and seasonal weather-ready finishing."
  },
  {
    title: "Color Consultation",
    detail: "Free in-home or remote color planning with brand-matched recommendations."
  },
  {
    title: "Cabinet Refinishing",
    detail: "Sanding, patching, staining, and modern finishes for a clean update."
  },
  {
    title: "Commercial Jobs",
    detail: "Tenant-ready schedules, minimal disruption windows, and contractor coordination."
  }
];

export default function ServicesScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headline}>Services</Text>
      <Text style={styles.subtext}>Select a service category below and request a quote for tailored pricing.</Text>

      <View style={styles.grid}>
        {services.map((service) => (
          <View key={service.title} style={styles.card}>
            <Text style={styles.cardTitle}>{service.title}</Text>
            <Text style={styles.cardText}>{service.detail}</Text>
          </View>
        ))}
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
    paddingBottom: 32
  },
  headline: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.primary,
    marginBottom: spacing.sm
  },
  subtext: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: spacing.md
  },
  grid: {
    gap: spacing.md
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.md
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
    color: colors.text
  },
  cardText: {
    color: colors.muted,
    lineHeight: 20
  }
});
