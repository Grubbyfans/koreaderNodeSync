import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/db", { recursive: true });
copyFileSync("src/db/schema.sql", "dist/db/schema.sql");
console.log("copied src/db/schema.sql -> dist/db/schema.sql");
