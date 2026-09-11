/** Client-side checks for the registration form; the API repeats them (ADR-0006). */

export const MIN_PASSWORD_LENGTH = 10;

export interface SignUpFields {
  readonly displayName: string;
  readonly email: string;
}

export type SignUpField = keyof SignUpFields | "password";

export interface SignUpProblem {
  readonly field: SignUpField;
  readonly message: string;
}

export function readSignUpForm(formData: FormData): SignUpFields & { readonly password: string } {
  return {
    displayName: String(formData.get("displayName") ?? "").trim().replace(/\s+/g, " "),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export function validateSignUp(input: SignUpFields & { readonly password: string }): SignUpProblem | null {
  if (input.displayName.length < 2) return { field: "displayName", message: "Tell us what to call you." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return { field: "email", message: "Enter a valid email address." };
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { field: "password", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return null;
}

/** Maps an API failure to the field it belongs to and the sentence the customer reads. */
export function signUpFailure(code: string, message: string): SignUpProblem {
  if (code === "email_taken") {
    return { field: "email", message: "An account with this email already exists. Sign in instead." };
  }
  if (code === "invalid_request") return { field: "password", message };
  return { field: "password", message: "We couldn't create your account just now. Nothing was saved; try again in a moment." };
}
