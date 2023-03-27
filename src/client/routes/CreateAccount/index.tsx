import React, { useRef } from "react";
import { Link, useHistory, Redirect } from "react-router-dom";
import { useForm } from "react-hook-form";

import { useCreateAccountMutation } from "types/graphql-schema-types";
import Header from "client/components/Header";
import TextField from "client/components/TextField";
import PageContent from "client/components/PageContent";
import useToast from "client/components/Toast/useToast";
import { emailRegex } from "utils/utils";

type FormData = {
  username: string;
  email: string;
  password: string;
  password2: string;
};

const CreateAccount = () => {
  const { showToast } = useToast();
  const {
    register,
    formState: { isValid, isSubmitted, errors },
    handleSubmit,
    setError,
    watch,
  } = useForm<FormData>();

  const passwordValue = watch("password");

  const [createAccount] = useCreateAccountMutation({
    onError: () => {
      showToast({ message: "Create account failed", type: "error" });
    },
  });
  const history = useHistory<IHistoryState>();
  const toastId = useRef<number>();

  const token = localStorage.getItem("token");
  if (token) {
    return <Redirect to="/lists" />;
  }

  const onSubmit = async ({
    username,
    email,
    password,
    password2,
  }: FormData) => {
    if (password !== password2) {
      setError(
        "password",
        { message: "Passwords do not match!" },
        { shouldFocus: true }
      );
      setError("password2", { message: "Passwords do not match." });
      return;
    }

    try {
      const resp = await createAccount({
        variables: { input: { username, password, email } },
      });

      if (resp.data) {
        localStorage.setItem("token", resp.data.createAccount.jwt);

        if (history.location.state?.referrer) {
          history.replace(history.location.state.referrer);
        } else {
          history.replace("/lists");
        }
      }
    } catch (e) {
      toastId.current = showToast({ message: "Login failed", type: "error" });
    }
  };

  return (
    <div>
      <Header />
      <PageContent>
        <h2 className="mt-10 mb-10 text-center text-3xl font-bold">
          CREATE ACCOUNT
        </h2>
        <form onSubmit={handleSubmit(onSubmit)}>
          <TextField
            {...register("username", {
              required: "Username is required.",
              maxLength: { value: 10, message: "Username is too long." },
              minLength: { value: 3, message: "Username is too short." },
            })}
            id="username"
            label="Username"
            error={errors.username}
          />
          <TextField
            {...register("email", {
              required: "email is required.",
              pattern: { value: emailRegex, message: "Invalid email format." },
            })}
            id="email"
            label="email"
            type="email"
            error={errors.email}
          />

          <TextField
            {...register("password", {
              required: "Password is required.",
              minLength: { value: 8, message: "Password is too short." },
            })}
            id="password"
            type="password"
            label="Password"
            error={errors.password}
          />

          <TextField
            {...register("password2", {
              required: "Password is required.",
              minLength: { value: 8, message: "Password is too short." },
              validate: {
                passwordsMatch: (v) =>
                  v === passwordValue || "Passwords do not match.",
              },
            })}
            id="password2"
            type="password"
            label="Password again"
            error={errors.password2}
          />

          <div className="flex items-center justify-between mt-6">
            <Link
              className="text-pink-500 hover:text-pink-700 font-semibold"
              to="/login"
            >
              Login
            </Link>
            <input
              className="py-2 px-5 bg-gradient-to-br from-purple-400 to-pink-500  rounded-sm text-white font-semibold hover:from-purple-500 hover:to-pink-600 shadow-lg focus:outline-none"
              type="submit"
              value="CREATE ACCOUNT"
              disabled={!isValid && isSubmitted}
            />
          </div>
        </form>
      </PageContent>
    </div>
  );
};

export default CreateAccount;
