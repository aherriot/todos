import path from "path";
import http from "http";
import express, { Request, Response } from "express";
import { execute, subscribe } from "graphql";
import { ApolloServer } from "apollo-server-express";
import expressPlayground from "graphql-playground-middleware-express";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { loadSchemaSync } from "@graphql-tools/load";
import { GraphQLFileLoader } from "@graphql-tools/graphql-file-loader";
import { addResolversToSchema } from "@graphql-tools/schema";
import jwt, { VerifyErrors } from "jsonwebtoken";

import { JwtPayload } from "types";
import graphqlResolvers from "./graphql/resolvers";
import context from "./graphql/context";
import config from "./config.json";
import db from "./db";

const schemaPath = path.join("buildServer", "graphql", "schema.graphql");

const graphqlSchema = loadSchemaSync(schemaPath, {
  loaders: [new GraphQLFileLoader()],
});

const schemaWithResolvers = addResolversToSchema({
  schema: graphqlSchema,
  resolvers: graphqlResolvers as any,
});

const apolloServer = new ApolloServer({
  schema: schemaWithResolvers,
  context,
});

const app = express();

app.get(
  "/playground",
  expressPlayground({
    endpoint: "/graphql",
    subscriptionEndpoint: `/subscriptions`,
  })
);

// Serve static assets
app.use(express.static("build"));

// Always return the main index.html, so react-router render the route in the src
app.get("*", (req: Request, res: Response) => {
  res.sendFile(path.resolve("build", "index.html"));
});

async function start() {
  const PORT = process.env.PORT || 8000;
  console.log(
    `Starting server: PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}.`
  );
  try {
    await db.verifyConnection();
    console.log("DB connection verified.");
  } catch (e) {
    console.error("DB connection failed.", e);
    process.exit(2);
  }

  await apolloServer.start();
  console.log("Apollo server started.");

  const httpServer = http.createServer(app);
  apolloServer.applyMiddleware({ app });

  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));

  console.log(`HTTP server started.`);

  new SubscriptionServer(
    {
      execute,
      subscribe,
      schema: schemaWithResolvers,
      keepAlive: 30000,
      onConnect: (
        { authorization }: any,
        webSocket: WebSocket,
        context: any
      ) => {
        if (authorization) {
          let user;
          let token = authorization.replace("Bearer ", "");

          if (token) {
            jwt.verify(
              token,
              config.jwt.secret,
              (err: VerifyErrors | null, decoded: unknown): void => {
                const decodedPayload = decoded as JwtPayload;
                if (err) {
                  if (err.name === "TokenExpiredError") {
                    throw new Error("JWT expired");
                  } else {
                    throw new Error("Invalid JWT");
                  }
                }

                if (decodedPayload) {
                  user = {
                    id: decodedPayload.id,
                    username: decodedPayload.username,
                  };
                }
              }
            );
          }
          return { user };
        }
        throw new Error("Missing JWT authorization");
      },
      onDisconnect: () => {},
    },
    { server: httpServer, path: "/subscriptions" }
  );

  console.log(
    `Main server started: PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}.`
  );
}

start();
