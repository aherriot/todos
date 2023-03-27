import React from "react";

export interface IUserContext {
  id: number;
  username: string;
  jwt?: string;
}

export default React.createContext<IUserContext | null>(null);
