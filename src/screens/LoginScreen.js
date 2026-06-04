import React from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { supabase } from "../lib/supabase";
import { colors } from "../theme";

const logo = require("../../assets/ottawa-painters-logo.png");

export default function LoginScreen() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [session, setSession] = React.useState(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

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

  const signOut = async () => {
    setError("");
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.content}>
        <Image source={logo} resizeMode="contain" style={styles.logo} />

        <View style={styles.form}>
          {session ? (
            <View style={styles.sessionBox}>
              <Text style={styles.sessionText}>Signed in as {session.user.email}</Text>
              <Pressable accessibilityRole="button" onPress={signOut}>
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={updateEmail}
            placeholder="name@paintersottawa.com"
            placeholderTextColor="#9AA7A3"
            returnKeyType="next"
            style={styles.input}
            textContentType="username"
            value={email}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={updatePassword}
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
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: Platform.select({ ios: 92, android: 62, default: 76 })
  },
  logo: {
    alignSelf: "flex-start",
    height: 112,
    marginBottom: 66,
    width: 284
  },
  form: {
    width: "100%"
  },
  sessionBox: {
    alignItems: "center",
    backgroundColor: colors.field,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  sessionText: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "700"
  },
  signOutText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800"
  },
  label: {
    color: colors.brandDeep,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 17,
    fontWeight: "500",
    height: 58,
    marginBottom: 24,
    paddingHorizontal: 18
  },
  passwordRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    height: 58,
    paddingLeft: 18
  },
  passwordInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 17,
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
    height: 58,
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
    fontSize: 18,
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
