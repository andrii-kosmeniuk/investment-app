import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, readSignUpForm, signUpFailure, validateSignUp } from "./sign-up";

const valid = { displayName: "Ada Lovelace", email: "ada@example.com", password: "a".repeat(MIN_PASSWORD_LENGTH) };

describe("sign-up form", () => {
  it("normalises whitespace in the name and email but never touches the password", () => {
    const form = new FormData();
    form.set("displayName", "  Ada   Lovelace ");
    form.set("email", " ada@example.com ");
    form.set("password", " spaced password ");
    expect(readSignUpForm(form)).toEqual({ displayName: "Ada Lovelace", email: "ada@example.com", password: " spaced password " });
  });

  it("accepts a complete form", () => {
    expect(validateSignUp(valid)).toBeNull();
  });

  it("names the first field that needs attention", () => {
    expect(validateSignUp({ ...valid, displayName: "A" })?.field).toBe("displayName");
    expect(validateSignUp({ ...valid, email: "not-an-email" })?.field).toBe("email");
    expect(validateSignUp({ ...valid, password: "short" })).toMatchObject({ field: "password", message: expect.stringContaining(String(MIN_PASSWORD_LENGTH)) });
  });

  it("maps API failures onto fields and never claims a partial success", () => {
    expect(signUpFailure("email_taken", "")).toMatchObject({ field: "email", message: expect.stringMatching(/already exists/i) });
    expect(signUpFailure("invalid_request", "Use a password of at least 10 characters")).toMatchObject({
      field: "password",
      message: "Use a password of at least 10 characters",
    });
    expect(signUpFailure("http_502", "").message).toMatch(/nothing was saved/i);
  });
});
