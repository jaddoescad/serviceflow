import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

const initialState = {
  name: "",
  phone: "",
  email: "",
  service: "",
  details: ""
};

export default function QuoteScreen() {
  const [form, setForm] = React.useState(initialState);

  const submit = () => {
    if (!form.name || !form.phone || !form.service) {
      Alert.alert("Missing details", "Please enter your name, phone and service type.");
      return;
    }

    Alert.alert(
      "Request received",
      `Thanks, ${form.name}! We'll contact you at ${form.phone} shortly for your ${form.service} quote.`
    );

    setForm(initialState);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Request a quote</Text>
      <Text style={styles.subtext}>Share your project details and we'll get back to you within 24 hours.</Text>

      <TextInput
        style={styles.input}
        value={form.name}
        onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
        placeholder="Your name"
      />
      <TextInput
        style={styles.input}
        value={form.phone}
        keyboardType="phone-pad"
        onChangeText={(value) => setForm((prev) => ({ ...prev, phone: value }))}
        placeholder="Phone number"
      />
      <TextInput
        style={styles.input}
        value={form.email}
        keyboardType="email-address"
        onChangeText={(value) => setForm((prev) => ({ ...prev, email: value }))}
        placeholder="Email (optional)"
      />
      <TextInput
        style={styles.input}
        value={form.service}
        onChangeText={(value) => setForm((prev) => ({ ...prev, service: value }))}
        placeholder="Service (Interior, Exterior, Cabinet...)"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        value={form.details}
        onChangeText={(value) => setForm((prev) => ({ ...prev, details: value }))}
        placeholder="Tell us about your space, timelines, and special instructions"
        multiline
      />

      <TouchableOpacity style={styles.button} onPress={submit} activeOpacity={0.85}>
        <Text style={styles.buttonText}>Submit request</Text>
      </TouchableOpacity>
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.card,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top"
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    alignItems: "center",
    padding: spacing.md
  },
  buttonText: {
    color: "white",
    fontWeight: "700"
  }
});
