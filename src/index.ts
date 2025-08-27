import { Elysia } from "elysia";

const app = new Elysia().get("/", () => "Hello Elysia2").listen(3000);

console.log(
  `🦊 Eldysia is runnisng at ${app.server?.hostname}:${app.server?.port}`
);
