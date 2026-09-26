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

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isValidPhone = (value) => value.replace(/\D/g, "").length >= 10;

export default function QuoteScreen() {
  const [form, setForm] = React.useState(initialState);
  const [errors, setErrors] = React.useState({});

  const updateField = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const submit = () => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Please enter your name.";
    if (!form.phone.trim()) nextErrors.phone = "Please enter your phone number.";
    else if (!isValidPhone(form.phone)) nextErrors.phone = "Enter a valid phone number.";
    if (form.email.trim() && !isValidEmail(form.email)) nextErrors.email = "Enter a valid email address.";
    if (!form.service.trim()) nextErrors.service = "Please enter a service type.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      Alert.alert("Missing details", "Please check the highlighted fields and try again.");
      return;
    }

    // TODO: persist this quote request to a backend table (needs a Supabase table).
    Alert.alert(
      "Request received",
      `Thanks, ${form.name}! We'll contact you at ${form.phone} shortly for your ${form.service} quote.`
    );

    setForm(initialState);
    setErrors({});
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Request a quote</Text>
      <Text style={styles.subtext}>Share your project details and we'll get back to you within 24 hours.</Text>

      <TextInput
        style={[styles.input, errors.name && styles.inputError]}
        value={form.name}
        onChangeText={updateField("name")}
        placeholder="Your name"
      />
      {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
      <TextInput
        style={[styles.input, errors.phone && styles.inputError]}
        value={form.phone}
        keyboardType="phone-pad"
        onChangeText={updateField("phone")}
        placeholder="Phone number"
      />
      {errors.phone ? <Text style={styles.fieldError}>{errors.phone}</Text> : null}
      <TextInput
        style={[styles.input, errors.email && styles.inputError]}
        value={form.email}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        onChangeText={updateField("email")}
        placeholder="Email (optional)"
      />
      {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
      <TextInput
        style={[styles.input, errors.service && styles.inputError]}
        value={form.service}
        onChangeText={updateField("service")}
        placeholder="Service (Interior, Exterior, Cabinet...)"
      />
      {errors.service ? <Text style={styles.fieldError}>{errors.service}</Text> : null}
      <TextInput
        style={[styles.input, styles.textArea]}
        value={form.details}
        onChangeText={updateField("details")}
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
  inputError: {
    borderColor: colors.danger
  },
  fieldError: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
    marginTop: -8,
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
