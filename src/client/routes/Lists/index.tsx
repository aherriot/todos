import React, { useState } from "react";
import { Link, Redirect } from "react-router-dom";
import produce from "immer";
// import { AuthenticationError } from "@apollo/client";
import {
  useCreateListMutation,
  useListsQuery,
  ListsQuery,
  ListsDocument,
  List,
} from "types/graphql-schema-types";

import Header from "client/components/Header";
import Button from "client/components/Button";
import PageContent from "client/components/PageContent";
import useToast from "client/components/Toast/useToast";
import useUser from "client/components/User/useUser";

const Lists = () => {
  const [newListName, setNewListName] = useState("");
  const { showToast } = useToast();
  const user = useUser();

  const { data, error } = useListsQuery({
    fetchPolicy: "cache-and-network",
    onError: (error) => {
      // const unauthenticated = error?.networkError?.result.errors.some((err) => {
      //   return err.extensions.code === "UNAUTHENTICATED";
      // });
      showToast({ message: "Request failed", type: "error" });
    },
    onCompleted: () => {},
    skip: !user,
  });

  const [createList] = useCreateListMutation({
    onError: () => {
      showToast({ message: "Create list failed", type: "error" });
    },
    onCompleted: () => {
      showToast({ message: "Created List" });
    },
    update: (cache, { data }) => {
      if (!data?.createList) {
        return;
      }

      const result = cache.readQuery<ListsQuery>({
        query: ListsDocument,
      });

      if (!result) {
        return;
      }

      cache.writeQuery({
        query: ListsDocument,
        data: produce(result, (draft) => {
          draft.lists.push(data.createList as List);
        }),
      });
    },
  });

  if (error) return <p>Error :(</p>;

  const addTodoList = () => {
    createList({ variables: { input: { name: newListName } } });
  };

  if (!user) {
    return (
      <Redirect
        to={{
          pathname: "/login",
          state: { referrer: window.location.pathname },
        }}
      />
    );
  }

  return (
    <div className="h-full">
      <Header />
      <PageContent>
        <h1 className="text-4xl text-center mt-4">Lists</h1>

        <ul>
          {data?.lists.map((list) => (
            <Link key={list.id} to={`/lists/${list.id}`}>
              <li className="py-5 px-3 text-xl w-full font-semibold border-b-2 border-gray-500 flex justify-between items-center">
                <span>{list.name}</span>
                <span className="text-sm text-gray-400">
                  {list.shared && list.owner.username}
                </span>
              </li>
            </Link>
          ))}
        </ul>

        <div className="w-full mt-5">
          <input
            className="border-green-500 border-2 rounded-md px-4 py-1 text-black"
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                addTodoList();
              }
            }}
          />
          <Button disabled={newListName.length === 0} onClick={addTodoList}>
            Add new List
          </Button>
        </div>
        <Link to="/lists/share">Share Lists</Link>
      </PageContent>
    </div>
  );
};

export default Lists;
