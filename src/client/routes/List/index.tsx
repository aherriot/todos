import React, { useState, useRef } from "react";
import { Redirect } from "react-router-dom";
import produce from "immer";
import {
  useListQuery,
  useCreateListItemMutation,
  useCompleteListItemMutation,
  useRemoveCompletedListItemsMutation,
  useOnListItemChangedSubscription,
  ListDocument,
  ListQuery,
} from "types/graphql-schema-types";

import Header from "client/components/Header";
import Button from "client/components/Button";
import PageContent from "client/components/PageContent";
import useToast from "client/components/Toast/useToast";
import useUser from "client/components/User/useUser";

interface Props {
  match: {
    params: { listId: string };
  };
}

const List = ({ match }: Props) => {
  const { showToast } = useToast();
  const [newTodoText, setNewTodoText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useUser();

  const { error, data: listData } = useListQuery({
    variables: { id: match.params.listId },
    fetchPolicy: "cache-and-network",
    onError: () => {
      showToast({ message: "Request failed", type: "error" });
    },
    skip: !user,
  });

  const { error: subscriptionError } = useOnListItemChangedSubscription({
    variables: { listId: match.params.listId },
    onSubscriptionData: ({ client, subscriptionData: { data } }) => {
      if (data) {
        const { listItemChanged: listItem } = data;

        if (!listItem) {
          return;
        }

        const list = client.readQuery<ListQuery>({
          query: ListDocument,
          variables: { id: match.params.listId },
        });

        if (!list) {
          return;
        }

        client.writeQuery({
          query: ListDocument,
          data: produce(list, (draft) => {
            const item = draft.list.items.find(
              (item) => item.id === listItem.id
            );
            if (item) {
              item.complete = listItem.complete;
            } else {
              draft.list.items.push(listItem);
            }
          }),
        });
      }
    },
  });

  const [createListItem] = useCreateListItemMutation({
    onError: () => {
      showToast({ message: "Create todo failed", type: "error" });
    },
    update: (cache, { data: result }) => {
      if (!result) {
        return;
      }

      const data = cache.readQuery<ListQuery>({
        query: ListDocument,
        variables: { id: match.params.listId },
      });

      if (
        !data ||
        data.list.items.find((item) => item.id === result?.createListItem.id)
      ) {
        return;
      }

      cache.writeQuery({
        query: ListDocument,
        data: produce(data, (draft) => {
          draft.list.items.push(result?.createListItem);
        }),
      });
    },
    optimisticResponse: {
      createListItem: {
        id: "-1",
        description: newTodoText,
        position: 0,
        complete: false,
      },
    },
  });

  const [completeListItem] = useCompleteListItemMutation({
    onError: () => {
      showToast({ message: "Marking todo failed", type: "error" });
    },
    onCompleted: () => {
      showToast({ message: "Marked todo" });
    },
  });

  const [removeCompletedListItems] = useRemoveCompletedListItemsMutation({
    onError: () => {
      showToast({ message: "Remove completed todos failed", type: "error" });
    },
    update: (cache, { data }) => {
      if (!data?.removeCompletedListItems) {
        return;
      }

      const result = cache.readQuery<ListQuery>({
        query: ListDocument,
        variables: { id: match.params.listId },
      });

      if (!result) {
        return;
      }

      cache.writeQuery({
        query: ListDocument,
        data: produce(result, (draft) => {
          draft.list.items = draft.list.items.filter((item) => !item.complete);
        }),
      });
    },
  });

  const addTodo = () => {
    if (newTodoText) {
      createListItem({
        variables: {
          input: { listId: match.params.listId, description: newTodoText },
        },
      });
      setNewTodoText("");
      inputRef.current?.focus();
    }
  };

  const list = listData?.list;

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

  if (error) {
    return <div>{JSON.stringify(error)}</div>;
  }

  if (subscriptionError) {
    return <div>{JSON.stringify(subscriptionError)}</div>;
  }

  if (!list) {
    return <div>Loading...</div>;
  }

  const incompletedItems = list.items
    .filter((item) => !item.complete)
    .sort((a, b) => a.position - b.position);

  const completedItems = list.items
    .filter((item) => item.complete)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="h-screen">
      <Header />
      <PageContent>
        <h2 className="text-lg font-semibold py-4">
          Todo: {listData?.list.name}
        </h2>
        <ul>
          {incompletedItems.map((item) => (
            <li
              className="cursor-pointer py-2 px-2 -mx-4 bg-gradient-to-r hover:from-purple-400 hover:to-pink-500 flex items-center"
              key={item.id}
              onClick={() =>
                completeListItem({
                  variables: {
                    input: { id: item.id, complete: !item.complete },
                  },
                })
              }
            >
              <span className="mr-2 pb-1 text-2xl font-bold text-purple-500 ">
                {"\u2610"}
              </span>
              {item.description}
            </li>
          ))}
        </ul>
        {incompletedItems.length === 0 && (
          <div className="text-center">List empty</div>
        )}

        <h2 className="text-lg font-semibold py-4">Completed Todos</h2>
        <ul>
          {completedItems.map((item) => (
            <li
              className="cursor-pointer py-2 px-2 -mx-4 text-gray-400 bg-gradient-to-r hover:from-gray-800 hover:to-gray-700 line-through flex items-center"
              key={item.id}
              onClick={() =>
                completeListItem({
                  variables: {
                    input: { id: item.id, complete: !item.complete },
                  },
                })
              }
            >
              <span className="mr-2 text-xl font-bold">{"\u2611"}</span>
              {item.description}
            </li>
          ))}
        </ul>
        {completedItems.length === 0 && (
          <div className="text-center">List empty</div>
        )}

        <div className="mt-8 text-center">
          <input
            className="text-black py-2 px-5 rounded-sm border-blue-600 border-2 mr-2 focus:rounded"
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            ref={inputRef}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                addTodo();
              }
            }}
          />
          <Button onClick={addTodo}>ADD</Button>
          <div className="mt-6">
            <button
              className="py-2 px-5 rounded-sm  bg-gradient-to-br from-red-400 to-red-700 text-white font-semibold hover:from-red-500 hover:to-red-800 shadow-lg"
              disabled={completedItems.length === 0}
              onClick={() => {
                removeCompletedListItems({
                  variables: { listId: match.params.listId },
                });
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
      </PageContent>
    </div>
  );
};

export default List;
