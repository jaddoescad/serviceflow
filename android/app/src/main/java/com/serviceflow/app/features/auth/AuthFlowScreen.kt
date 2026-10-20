package com.serviceflow.app.features.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.serviceflow.app.LocalAppModel
import com.serviceflow.app.backend.sendPasswordResetCode
import com.serviceflow.app.backend.sendSignInCode
import com.serviceflow.app.backend.sendSignUpCode
import com.serviceflow.app.backend.signIn
import com.serviceflow.app.backend.updateAccount
import com.serviceflow.app.backend.verifyEmailCode
import com.serviceflow.app.backend.verifyPasswordResetCode
import com.serviceflow.app.design.rememberRequestState
import com.serviceflow.core.AccountValidation

private enum class CodePurpose { SignUp, Reset }

private sealed class Step {
    data object SignUp : Step()
    data object Forgot : Step()
    data class Verify(val email: String, val purpose: CodePurpose) : Step()
    data class SetPassword(val purpose: CodePurpose) : Step()
}

private val StepsSaver = Saver<List<Step>, ArrayList<String>>(
    save = { steps ->
        ArrayList(steps.map {
            when (it) {
                Step.SignUp -> "signUp"
                Step.Forgot -> "forgot"
                is Step.Verify -> "verify|${it.purpose.name}|${it.email}"
                is Step.SetPassword -> "setPassword|${it.purpose.name}"
            }
        })
    },
    restore = { saved ->
        saved.map {
            val parts = it.split("|", limit = 3)
            when (parts[0]) {
                "signUp" -> Step.SignUp
                "forgot" -> Step.Forgot
                "verify" -> Step.Verify(parts[2], CodePurpose.valueOf(parts[1]))
                else -> Step.SetPassword(CodePurpose.valueOf(parts[1]))
            }
        }
    },
)

/** Signed-out screens: sign in, create an account, reset a password. */
@Composable
fun AuthFlowScreen() {
    var path by rememberSaveable(stateSaver = StepsSaver) { mutableStateOf(emptyList<Step>()) }
    var email by rememberSaveable { mutableStateOf("") }
    var signUpName by rememberSaveable { mutableStateOf("") }
    fun push(step: Step) { path = path + step }
    val back = { path = path.dropLast(1) }

    // The password step has no way back: the code already signed the person in.
    BackHandler(enabled = path.isNotEmpty()) { if (path.last() !is Step.SetPassword) back() }

    BrandTint {
        when (val step = path.lastOrNull()) {
            null -> SignInScreen(email, { email = it }, onCreateAccount = { push(Step.SignUp) }, onForgot = { push(Step.Forgot) })
            Step.SignUp -> SignUpScreen(email, { email = it }, signUpName, { signUpName = it }, onBack = back) { push(Step.Verify(it, CodePurpose.SignUp)) }
            Step.Forgot -> ForgotPasswordScreen(email, { email = it }, onBack = back) { push(Step.Verify(it, CodePurpose.Reset)) }
            is Step.Verify -> VerifyCodeScreen(step.email, step.purpose, onBack = back) { push(Step.SetPassword(step.purpose)) }
            is Step.SetPassword -> SetPasswordScreen(step.purpose)
        }
    }
}

// MARK: Sign in

@Composable
private fun SignInScreen(email: String, onEmailChange: (String) -> Unit, onCreateAccount: () -> Unit, onForgot: () -> Unit) {
    val model = LocalAppModel.current
    var password by rememberSaveable { mutableStateOf("") }
    var emailError by rememberSaveable { mutableStateOf<String?>(null) }
    val request = rememberRequestState()
    val canSubmit = email.isNotBlank() && password.isNotBlank()

    fun submit() {
        if (!canSubmit) {
            request.error = "Enter your email and password."
            return
        }
        val address = email.trim()
        emailError = AccountValidation.email(address)
        if (emailError != null) return
        val api = model.api ?: return
        // The password is sent as typed; only the email is trimmed.
        request.run { api.signIn(email = address, password = password) }
    }

    AuthForm(title = null, onBack = null) {
        AuthLogo(Modifier.padding(bottom = 16.dp))
        AuthTextField(
            label = "Email", value = email, onValueChange = { onEmailChange(it); emailError = null; request.error = null },
            content = ContentType.EmailAddress + ContentType.Username, keyboard = KeyboardType.Email,
            error = emailError,
        )
        AuthPasswordField(
            value = password, onValueChange = { password = it; request.error = null },
            onSubmit = ::submit, modifier = Modifier.padding(top = 8.dp),
        )
        AuthFooter(error = request.error)
        AuthPrimaryButton(title = "Log In", busy = request.isRunning, enabled = canSubmit, onClick = ::submit)
        TextButton(onClick = onForgot, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) {
            Text("Forgot password?")
        }
        Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("New to ServiceFlow?", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onCreateAccount, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text("Create an Account")
            }
        }
    }
}

// MARK: Create account

@Composable
private fun SignUpScreen(email: String, onEmailChange: (String) -> Unit, name: String, onNameChange: (String) -> Unit,
                         onBack: () -> Unit, onCodeSent: (String) -> Unit) {
    val model = LocalAppModel.current
    val request = rememberRequestState()

    fun submit() {
        val address = email.trim().lowercase()
        val fullName = name.trim()
        val problem = AccountValidation.name(fullName) ?: AccountValidation.email(address)
        if (problem != null) {
            request.error = problem
            return
        }
        val api = model.api ?: return
        request.run {
            api.sendSignUpCode(email = address, name = fullName)
            onCodeSent(address)
        }
    }

    AuthForm(title = "Create Account", onBack = onBack) {
        AuthHeader("Start a company, or join your team with an invite code.")
        AuthTextField(
            label = "Your name", value = name, onValueChange = { onNameChange(it); request.error = null },
            content = ContentType.PersonFullName, capitalization = KeyboardCapitalization.Words,
        )
        AuthTextField(
            label = "Email", value = email, onValueChange = { onEmailChange(it); request.error = null },
            content = ContentType.EmailAddress, keyboard = KeyboardType.Email, imeAction = ImeAction.Send,
            onSubmit = ::submit, modifier = Modifier.padding(top = 8.dp),
        )
        AuthFooter(error = request.error, hint = "We'll email you a 6-digit code to confirm it's you.")
        AuthPrimaryButton(title = "Send Code", busy = request.isRunning, enabled = true, onClick = ::submit)
    }
}

// MARK: Forgot password

@Composable
private fun ForgotPasswordScreen(email: String, onEmailChange: (String) -> Unit, onBack: () -> Unit, onCodeSent: (String) -> Unit) {
    val model = LocalAppModel.current
    val request = rememberRequestState()

    fun submit() {
        val address = email.trim().lowercase()
        AccountValidation.email(address)?.let {
            request.error = it
            return
        }
        val api = model.api ?: return
        request.run {
            api.sendPasswordResetCode(email = address)
            onCodeSent(address)
        }
    }

    AuthForm(title = "Reset Password", onBack = onBack) {
        AuthTextField(
            label = "Email", value = email, onValueChange = { onEmailChange(it); request.error = null },
            content = ContentType.EmailAddress + ContentType.Username, keyboard = KeyboardType.Email,
            imeAction = ImeAction.Send, onSubmit = ::submit,
        )
        AuthFooter(error = request.error, hint = "We'll email you a 6-digit code to set a new password.")
        AuthPrimaryButton(title = "Send Code", busy = request.isRunning, enabled = true, onClick = ::submit)
    }
}

// MARK: Verify code

@Composable
private fun VerifyCodeScreen(email: String, purpose: CodePurpose, onBack: () -> Unit, onVerified: () -> Unit) {
    val model = LocalAppModel.current
    var code by rememberSaveable { mutableStateOf("") }
    val request = rememberRequestState()
    var resendNote by remember { mutableStateOf<String?>(null) }

    fun verify(value: String = code) {
        val api = model.api
        if (value.length != 6 || api == null) return
        request.run {
            // Keep these screens up after the code signs the person in, until
            // a password is set.
            model.holdAuthFlow = true
            try {
                when (purpose) {
                    CodePurpose.SignUp -> api.verifyEmailCode(email = email, code = value)
                    CodePurpose.Reset -> api.verifyPasswordResetCode(email = email, code = value)
                }
            } catch (e: Throwable) {
                model.holdAuthFlow = false
                throw e
            }
            onVerified()
        }
    }

    fun resend() {
        val api = model.api ?: return
        resendNote = null
        request.run {
            when (purpose) {
                CodePurpose.SignUp -> api.sendSignInCode(email = email)
                CodePurpose.Reset -> api.sendPasswordResetCode(email = email)
            }
            resendNote = "A new code is on its way."
        }
    }

    AuthForm(title = "Check Your Email", onBack = onBack) {
        AuthHeader("Enter the 6-digit code sent to $email.")
        CodeField(code = code, onCodeChange = { code = it; request.error = null }, onComplete = { verify() })
        AuthFooter(error = request.error, hint = resendNote)
        AuthPrimaryButton(title = "Continue", busy = request.isRunning, enabled = code.length == 6, onClick = { verify() })
        TextButton(onClick = ::resend, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) {
            Text("Send a New Code")
        }
    }
}

// MARK: Set password

@Composable
private fun SetPasswordScreen(purpose: CodePurpose) {
    val model = LocalAppModel.current
    var password by rememberSaveable { mutableStateOf("") }
    val request = rememberRequestState()

    fun save() {
        AccountValidation.password(password)?.let {
            request.error = it
            return
        }
        val api = model.api ?: return
        request.run {
            api.updateAccount(password = password)
            model.finishAuthFlow()
        }
    }

    AuthForm(title = if (purpose == CodePurpose.SignUp) "Choose a Password" else "New Password", onBack = null) {
        AuthPasswordField(
            label = "New password", value = password, onValueChange = { password = it; request.error = null },
            content = ContentType.NewPassword, onSubmit = ::save,
        )
        AuthFooter(error = request.error, hint = "Use at least 8 characters. You'll sign in with your email and this password.")
        AuthPrimaryButton(title = "Save Password", busy = request.isRunning, enabled = password.isNotEmpty(), onClick = ::save)
    }
}
