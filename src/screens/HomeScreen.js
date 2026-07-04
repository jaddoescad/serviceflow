import React from "react";
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

const highlights = [
  "Interior painting and color matching",
  "Exterior painting and power washing",
  "Cabinet refinishing and trim detail work",
  "Free estimates and same-week appointments"
];

const services = [
  { title: "Residential", detail: "Home interiors, exteriors, and deck prep/painting." },
  { title: "Commercial", detail: "Offices, condos, and property maintenance crews." },
  { title: "Renovation", detail: "Surface prep, texture, caulking, and finishing touch-ups." }
];

export default function HomeScreen() {
  // TODO: replace with real URL
  const openWebsite = () =>
    Linking.openURL("https://serviceflow.example.com").catch(() => {});

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.title}>ServiceFlow</Text>
        <Text style={styles.subtitle}>Field-service assignments, clock-ins, and job-site updates for mobile teams.</Text>
        <TouchableOpacity style={styles.cta} onPress={openWebsite} activeOpacity={0.8}>
          <Text style={styles.ctaText}>Get a free quote</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Why choose us</Text>
        {highlights.map((item) => (
          <Text key={item} style={styles.bullet}>• {item}</Text>
        ))}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Core services</Text>
        {services.map((service) => (
          <View key={service.title} style={styles.serviceRow}>
            <Text style={styles.serviceName}>{service.title}</Text>
            <Text style={styles.serviceDetail}>{service.detail}</Text>
          </View>
        ))}
      </View>

      <View style={styles.badgeCard}>
        <Text style={styles.badgeTitle}>Service area</Text>
        <Text style={styles.badgeText}>Built for field crews, dispatchers, and operations teams.</Text>
      </View>

      <Image
        style={styles.photo}
        source={{ uri: "https://images.unsplash.com/photo-1600566753370-84e7f1a53f26?auto=format&fit=crop&w=1000&q=80" }}
      />
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
  hero: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.primary
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 16,
    color: colors.text,
    lineHeight: 22
  },
  cta: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md
  },
  ctaText: {
    color: "white",
    fontWeight: "700"
  },
  sectionCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: spacing.md
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.md,
    color: colors.text
  },
  bullet: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: 8
  },
  serviceRow: {
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  serviceName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text
  },
  serviceDetail: {
    marginTop: 3,
    color: colors.muted
  },
  badgeCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.md
  },
  badgeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary
  },
  badgeText: {
    marginTop: 6,
    color: colors.text
  },
  photo: {
    height: 190,
    borderRadius: radius.card,
    backgroundColor: colors.border
  }
});
