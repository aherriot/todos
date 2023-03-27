import React from "react";
import jwtDecode from "jwt-decode";

import UserContext, { IUserContext } from "./UserContext";

interface Props {
  children: React.ReactNode;
}

const UserProvider = ({ children }: Props) => {
  let decoded: IUserContext | null = null;

  const token = localStorage.getItem("token");
  if (token) {
    decoded = jwtDecode(token);
    if (decoded) {
      decoded.jwt = token;
    }
  }
  return (
    <UserContext.Provider value={decoded}>{children}</UserContext.Provider>
  );
};

export default UserProvider;
