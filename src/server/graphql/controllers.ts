import { ApolloError, UserInputError } from "apollo-server-express";
import jwt from "jsonwebtoken";
import { QueryResult } from "pg";

import { User, List, ListItem } from "types/graphql-schema-types";
import {
  Users,
  Lists,
  ListItems,
  // SharedLists,
} from "types/db-schema-types";

import pubsub, { EVENTS } from "./pubsub";
import db from "../db";
import { verify, kdf } from "../utils/crypto";
import config from "../config.json";

type ListResult = Lists & { owner_id: number; is_shared: boolean };
export type ResolvedList = Pick<
  List,
  "id" | "name" | "createdAt" | "updatedAt"
> & {
  ownerId?: string;
  shared?: boolean;
};

export type ResolvedListItem = Pick<
  ListItem,
  "id" | "description" | "complete" | "position" | "createdAt" | "updatedAt"
> & {
  listId: string;
  lastUpdatedUserId?: string | null;
};
export type ResolvedUser = Pick<User, "id" | "username" | "email">;

const convertDbRowToUser = (row: Users): ResolvedUser => {
  return {
    id: row.id.toString(),

    username: row.username,
    email: row.email,
  };
};

const convertDbRowToList = (row: Lists | ListResult): ResolvedList => {
  const data: ResolvedList = {
    id: row.id.toString(),
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if ("owner_id" in row) {
    data.ownerId = row.owner_id.toString();
  }
  if ("user_id" in row) {
    data.ownerId = row.user_id.toString();
  }

  if ("is_shared" in row) {
    data.shared = row.is_shared;
  } else {
    data.shared = false;
  }

  return data;
};

const convertDbRowToListItem = (row: ListItems): ResolvedListItem => {
  const data: ResolvedListItem = {
    id: row.id.toString(),
    listId: row.list_id.toString(),
    description: row.description,
    complete: row.complete,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if ("last_user_id" in row) {
    data.lastUpdatedUserId = row.last_user_id?.toString();
  }

  return data;
};

export const getUser = async (userId: string): Promise<ResolvedUser> => {
  let result;
  try {
    result = await db.query<Users>(
      "select * from users where id = $1 limit 1;",
      [userId]
    );
  } catch (e) {
    throw new ApolloError("Invalid user query", "BAD_REQUEST", { error: e });
  }

  if (result.rowCount === 0) {
    throw new ApolloError("User not found");
  }

  return convertDbRowToUser(result.rows[0]);
};

export const getList = async (
  listId: string,
  userId: string
): Promise<ResolvedList> => {
  let result;
  try {
    result = await db.query<ListResult>(
      `select 
            l.*, 
            coalesce(sl.owner_id, l.user_id) as owner_id,
            sl.owner_id is not null as is_shared
        from lists l
        left join shared_lists sl on l.user_id = sl.owner_id
        where l.id = $1 and (l.user_id = $2 or sl.guest_id = $2)
        limit 1;`,
      [listId, userId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  if (result.rowCount === 0) {
    throw new ApolloError("List not found", "BAD_REQUEST");
  }

  return convertDbRowToList(result.rows[0]);
};

export const getLists = async (userId: string) => {
  let result;
  try {
    result = await db.query<ListResult>(
      `select 
              l.*, 
              coalesce(sl.owner_id, l.user_id) as owner_id,
              coalesce(sl.owner_id != $1, false) as is_shared 
            from lists l
            left join shared_lists sl 
                on sl.owner_id = l.user_id
            where l.user_id = $1 or sl.guest_id = $1;`,
      [userId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  return result.rows.map(convertDbRowToList);
};

export const getListItems = async (
  listId: string
): Promise<ResolvedListItem[]> => {
  let result;
  try {
    result = await db.query<ListItems>(
      `select * from list_items
        where list_id = $1
        order by position;`,
      [listId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  return result.rows.map(convertDbRowToListItem);
};

export const getSharedListsUsers = async (userId: string) => {
  try {
    const result = await db.query<Users>(
      `select u.* 
        from shared_lists sl 
        inner join users u 
          on u.id = sl.guest_id 
        where sl.owner_id = $1;`,
      [userId]
    );

    return result.rows.map(convertDbRowToUser) as User[];
  } catch (e) {
    throw new ApolloError("Invalid DB query", "BAD_REQUEST", { error: e });
  }
};

export const login = async (username: string, password: string) => {
  if (!username) {
    throw new UserInputError("Missing username", {
      username: "Username is required.",
    });
  }

  if (!password) {
    throw new UserInputError("Missing password", {
      password: "Password is required.",
    });
  }

  let result;
  try {
    result = await db.query<Users>(
      `select id, username, password 
        from users 
        where username = $1 limit 1;`,
      [username]
    );
  } catch (e) {
    throw new ApolloError("Invalid user query", "BAD_REQUEST", {
      error: e,
    });
  }

  if (result.rows.length !== 1) {
    throw new UserInputError("User not found", {
      username: "Username not found.",
    });
  }

  const user = result.rows[0];

  let isVerified;
  try {
    isVerified = await verify(password, user.password);
  } catch (e) {
    throw new ApolloError("Error validating password", "BAD_REQUEST", {
      error: e,
    });
  }

  if (!isVerified) {
    throw new UserInputError("Invalid password", {
      password: "Password is incorrect.",
    });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiry,
    }
  );

  return { jwt: token };
};

export const createAccount = async (
  username: string,
  password: string,
  email: string
) => {
  if (!username || !password || !email) {
    throw new ApolloError(
      "Missing username, password, or email",
      "BAD_REQUEST"
    );
  }

  let result;
  try {
    result = await db.query<Users>(
      `select id, username, password 
          from users
           where username = $1 limit 1;`,
      [username]
    );
  } catch (e) {
    throw new ApolloError("Invalid user query", "BAD_REQUEST", {
      error: e,
    });
  }

  // user already exists
  if (result.rows.length === 1) {
    throw new ApolloError("User already exists", "BAD_REQUEST");
  }

  let key;
  try {
    key = await kdf(password);
  } catch (e) {
    throw new ApolloError("Invalid password", "BAD_REQUEST", { error: e });
  }

  let result2: any;
  try {
    result2 = await db.query<Users>(
      `insert into 
          users (username, password, email) 
          values ($1, $2, $3) 
          returning *;`,
      [username.toLowerCase(), key, email.toLowerCase()]
    );
  } catch (e) {
    throw new ApolloError("Unable to add user", "BAD_REQUEST", {
      error: e,
    });
  }

  const token = jwt.sign(
    { id: result2.id, username: result2.username },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiry,
    }
  );

  return { jwt: token };
};

export const createList = async (
  userId: string,
  name: string,
  position: number | null | undefined
) => {
  let result: QueryResult<Lists>;
  try {
    result = await db.query<Lists>(
      `insert into lists
        (user_id, name)
        values
        ($1, $2)
        returning *;`,
      [userId, name]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  return convertDbRowToList(result.rows[0]);
};

export const deleteList = async (userId: string, listId: string) => {
  let result;
  try {
    result = await db.query(
      `delete from lists
        where user_id = $1 and id = $2`,
      [userId, listId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  if (result.rowCount !== 1) {
    throw new ApolloError("Could not find list to delete.", "BAD_REQUEST");
  }

  return listId;
};

export const shareLists = async (
  userId: string,
  username: string | null | undefined,
  email: string | null | undefined
) => {
  let userResult;
  try {
    userResult = await db.query<Users>(
      `select id, username
        from users
        where username=$1 or email=$2
        limit 1;`,
      [username, email]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  if (userResult.rowCount !== 1) {
    throw new ApolloError("User not found", "BAD_REQUEST");
  }

  const guestId = userResult.rows[0].id.toString();

  if (guestId === userId) {
    throw new ApolloError("Cannot share with yourself", "BAD_REQUEST");
  }

  let result;
  try {
    result = await db.query(
      `insert into shared_lists 
        (owner_id, guest_id) 
         values ($1, $2)
         on conflict(owner_id, guest_id) do nothing;`,
      [userId, guestId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  if (result.rowCount === 0) {
    throw new ApolloError("Lists already shared with this user", "BAD_REQUEST");
  }

  return convertDbRowToUser(userResult.rows[0]) as User;
};

export const unshareLists = async (userId: string, guestId: string) => {
  let result;
  try {
    result = await db.query(
      `delete from shared_lists 
        where owner_id = $1 and guest_id = $2;`,
      [userId, guestId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  if (result.rowCount !== 1) {
    throw new ApolloError("Lists not shared with this user.", "BAD_REQUEST");
  }

  return guestId;
};

export const createListItem = async (
  userId: string,
  listId: string,
  description: string,
  position: number | null | undefined
) => {
  let result;

  if (description.length === 0) {
    throw new ApolloError("description must not be empty", "BAD_REQUEST");
  }

  try {
    if (position != null) {
      result = await db.transaction(async (query: typeof db.query) => {
        await query(
          `update list_items
            set position = position + 1
            where position >= $2 and list_id = $1;`,
          [listId, position]
        );
        const innerResult = await query(
          "insert into list_items (list_id, description, position, last_user_id) values ($1, $2, $3, $4) returning *;",
          [listId, description, position, userId]
        );

        await query("select nextval('list_items_position_seq');");

        return innerResult;
      });
    } else {
      const list = await getList(listId, userId);

      if (list) {
        result = await db.query(
          `insert into list_items
            (list_id, description, last_user_id)
            values
            ($1, $2, $3)
            returning *;`,
          [listId, description, userId]
        );
      }
    }
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  const listItem = convertDbRowToListItem(result.rows[0]);

  pubsub.publish(EVENTS.LIST_ITEM_CHANGED, {
    listItemChanged: listItem,
  });

  return listItem as ResolvedListItem;
};

export const completeListItem = async (
  userId: string,
  listItemId: string,
  complete: boolean
) => {
  let result;
  console.log(userId, listItemId, complete);
  try {
    result = await db.query<any>(
      `update list_items li
          set complete = $2
          from lists l, shared_lists sl
          where 
              li.id = $1
              and l.id = li.list_id 
              and sl.owner_id = l.user_id
              and (l.user_id = $3 or sl.guest_id = $3)
          returning li.*;`,
      [listItemId, complete, userId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }

  const listItem = convertDbRowToListItem(result.rows[0]);
  pubsub.publish(EVENTS.LIST_ITEM_CHANGED, {
    listItemChanged: listItem,
  });

  return listItem as ResolvedListItem;
};

export const removeCompletedListItems = async (
  userId: string,
  listId: string
) => {
  let result;

  try {
    result = await db.query(
      "delete from list_items where complete = true and list_id = $1",
      [listId]
    );
  } catch (e) {
    throw new ApolloError("DB query failed", "BAD_REQUEST", { error: e });
  }
  pubsub.publish(EVENTS.COMPLETED_LIST_ITEMS_REMOVED, {
    completedListItemsRemoved: true,
    listId,
  });

  return result.rowCount;
};
