import React from "react";
import {
  Image,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { colors } from "../theme";

// Trimmed copy of the logo: the original has ~15% white margin above and below
// the artwork baked in, which rendered as dead space under the logo.
const logo = require("../../assets/serviceflow-logo-trimmed.png");

export default function LoginScreen() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const passwordRef = React.useRef(null);

  // Auth session ownership lives in App.js (getSession + onAuthStateChange).
  // This screen only handles the sign-in form.

  const canSubmit = email.trim().length > 0 && password.trim().length > 0 && !loading;

  const submit = async () => {
    if (!canSubmit) {
      setError("Enter your email and password.");
      return;
    }

    setError("");
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
    }
  };

  const updateEmail = (value) => {
    setEmail(value);
    if (error) setError("");
  };

  const updatePassword = (value) => {
    setPassword(value);
    if (error) setError("");
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        // Android's manifest already sets adjustResize, so letting
        // KeyboardAvoidingView also resize would double-adjust the layout.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {/* Scrollable so the focused field can move above the keyboard rather
            than sitting behind it, and so short screens are not cut off. */}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        <Image source={logo} resizeMode="contain" style={styles.logo} />

        <View style={styles.form}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            blurOnSubmit={false}
            keyboardType="email-address"
            onChangeText={updateEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="name@company.com"
            placeholderTextColor="#9AA7A3"
            returnKeyType="next"
            style={styles.input}
            textContentType="emailAddress"
            value={email}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              ref={passwordRef}
              autoCapitalize="none"
              autoComplete="password"
              autoCorrect={false}
              onChangeText={updatePassword}
              onSubmitEditing={submit}
              placeholder="Password"
              placeholderTextColor="#9AA7A3"
              returnKeyType="done"
              secureTextEntry={!showPassword}
              style={styles.passwordInput}
              textContentType="password"
              value={password}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowPassword((current) => !current)}
              style={styles.showButton}
            >
              <Text style={styles.showText}>{showPassword ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>

          <View style={styles.errorSlot}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={submit}
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed
            ]}
          >
            <Text style={styles.buttonText}>{loading ? "Signing In..." : "Log In"}</Text>
          </Pressable>

          <Text style={styles.helper}>Employee accounts are created by the office.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface
  },
  flex: { flex: 1 },
  content: {
    // Top-aligned. SafeAreaView already clears the status bar, so this padding
    // is measured from below it, not from the top of the screen.
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 32
  },
  logo: {
    alignSelf: "center",
    // Explicit height, not aspectRatio: aspectRatio produced a box taller than
    // the artwork, and "contain" then centred the logo in the dead space.
    // 230x147 matches the trimmed asset's 1.564 ratio, so nothing is letterboxed.
    width: "100%",
    maxWidth: 230,
    height: 147,
    marginBottom: 28
  },
  form: {
    width: "100%",
    // Keeps the form a sensible width on tablets and large phones.
    maxWidth: 420,
    alignSelf: "center"
  },
  label: {
    color: colors.brandDeep,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "500",
    height: 52,
    marginBottom: 18,
    paddingHorizontal: 16
  },
  passwordRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    height: 52,
    paddingLeft: 16
  },
  passwordInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    height: "100%"
  },
  showButton: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  showText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: "800"
  },
  errorSlot: {
    height: 30,
    justifyContent: "center"
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700"
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: 10,
    height: 52,
    justifyContent: "center"
  },
  buttonDisabled: {
    backgroundColor: "#A8C9C3"
  },
  buttonPressed: {
    backgroundColor: colors.brandDeep,
    transform: [{ translateY: 1 }]
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800"
  },
  helper: {
    color: colors.inkMuted,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 18,
    textAlign: "center"
  }
});
